import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const ISSUER = 'https://idp.test';
const AUDIENCE = 'meugmill';
const KID = 'k1';

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

let keys: KeyPair;
let otherKeys: KeyPair;
let jwks: { keys: JWK[] };
let idp: Server;
let jwksUri: string;

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  otherKeys = await generateKeyPair('RS256');
  jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }] };
  idp = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(jwks));
  });
  jwksUri = `http://127.0.0.1:${await listen(idp)}/jwks`;
});

afterAll(async () => {
  if (idp.listening) await close(idp);
});

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function make(env: Record<string, string> = {}): Promise<FastifyInstance> {
  const app = buildApp(
    loadConfig({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: AUDIENCE,
      OIDC_JWKS_URI: jwksUri,
      ...env,
    }),
  );
  apps.push(app);
  await app.ready();
  return app;
}

interface SignOptions {
  key?: CryptoKey;
  issuer?: string;
  audience?: string;
  expiresIn?: string | number;
  claims?: Record<string, unknown>;
}

function sign(opts: SignOptions = {}): Promise<string> {
  const jwt = new SignJWT({ roles: ['vendedor'], branch_ids: ['f1', 'f2'], ...opts.claims })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject('user-1')
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '5m');
  return jwt.sign(opts.key ?? keys.privateKey);
}

async function getMe(app: FastifyInstance, token?: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
}

function expectUnauthorized(res: Awaited<ReturnType<typeof getMe>>): void {
  expect(res.statusCode).toBe(401);
  expect(res.json()).toEqual({ error: 'unauthorized' });
  expect(res.headers['www-authenticate']).toBe('Bearer');
}

describe('GET /v1/me', () => {
  it('token válido retorna 200 com as claims mapeadas', async () => {
    const app = await make();
    const res = await getMe(app, await sign());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sub: 'user-1', roles: ['vendedor'], branchIds: ['f1', 'f2'] });
  });

  it('aceita claim string e a converte em lista', async () => {
    const app = await make();
    const res = await getMe(app, await sign({ claims: { roles: 'admin', branch_ids: 'f9' } }));
    expect(res.json()).toEqual({ sub: 'user-1', roles: ['admin'], branchIds: ['f9'] });
  });

  it('usa nomes de claims customizados', async () => {
    const app = await make({ OIDC_CLAIM_ROLES: 'perfis', OIDC_CLAIM_BRANCHES: 'filiais' });
    const token = await sign({ claims: { perfis: ['gestor'], filiais: ['f7'] } });
    const res = await getMe(app, token);
    expect(res.json()).toEqual({ sub: 'user-1', roles: ['gestor'], branchIds: ['f7'] });
  });

  it('não expõe campos extras do payload (email, name)', async () => {
    const app = await make();
    const res = await getMe(app, await sign({ claims: { email: 'a@b.com', name: 'Fulano', cpf: '1' } }));
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(['branchIds', 'roles', 'sub']);
    expect(res.body).not.toMatch(/a@b\.com|Fulano/);
  });

  it('sem token retorna 401', async () => {
    expectUnauthorized(await getMe(await make()));
  });

  it('formato de Authorization errado retorna 401', async () => {
    const app = await make();
    const token = await sign();
    expectUnauthorized(await getMe(app, undefined, { authorization: `Basic ${token}` }));
    expectUnauthorized(await getMe(app, undefined, { authorization: token }));
    expectUnauthorized(await getMe(app, 'lixo.nao.jwt'));
  });

  it('token expirado retorna 401', async () => {
    const app = await make({ OIDC_CLOCK_TOLERANCE_SECONDS: '0' });
    expectUnauthorized(await getMe(app, await sign({ expiresIn: Math.floor(Date.now() / 1000) - 60 })));
  });

  it('issuer errado retorna 401', async () => {
    expectUnauthorized(await getMe(await make(), await sign({ issuer: 'https://evil.test' })));
  });

  it('audience errada retorna 401', async () => {
    expectUnauthorized(await getMe(await make(), await sign({ audience: 'outro' })));
  });

  it('HS256 assinado com segredo retorna 401', async () => {
    const token = await new SignJWT({ roles: ['admin'] })
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setSubject('user-1')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!'));
    expectUnauthorized(await getMe(await make(), token));
  });

  it('alg none retorna 401', async () => {
    const b64 = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'none' })}.${b64({
      sub: 'u',
      iss: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 300,
    })}.`;
    expectUnauthorized(await getMe(await make(), token));
  });

  it('token assinado por outra chave retorna 401', async () => {
    expectUnauthorized(await getMe(await make(), await sign({ key: otherKeys.privateKey })));
  });

  it('descobre o jwks_uri via openid-configuration quando OIDC_JWKS_URI está ausente', async () => {
    const discovery = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(req.url?.endsWith('/openid-configuration') ? JSON.stringify({ jwks_uri: jwksUri }) : '{}');
    });
    const port = await listen(discovery);
    try {
      const app = await make({ OIDC_ISSUER: `http://127.0.0.1:${port}` });
      const token = await sign({ issuer: `http://127.0.0.1:${port}` });
      expect((await getMe(app, token)).statusCode).toBe(200);
    } finally {
      await close(discovery);
    }
  });

  it('JWKS fora do ar retorna 503 sem vazar detalhes', async () => {
    const dead = createServer();
    const port = await listen(dead);
    await close(dead);
    const app = await make({ OIDC_JWKS_URI: `http://127.0.0.1:${port}/jwks` });
    const res = await getMe(app, await sign());
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'auth_unavailable' });
  });
});

describe('rotas públicas e CORS', () => {
  it('/health e /ready seguem sem auth', async () => {
    const app = await make();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('origem listada recebe Access-Control-Allow-Origin, sem credentials', async () => {
    const app = await make({ CORS_ORIGINS: 'http://localhost:5173' });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('preflight libera Authorization e os métodos configurados', async () => {
    const app = await make({ CORS_ORIGINS: 'http://localhost:5173' });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, PUT, PATCH, DELETE');
  });

  it('origem não listada não recebe Access-Control-Allow-Origin', async () => {
    const app = await make({ CORS_ORIGINS: 'http://localhost:5173' });
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.test' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('CORS_ORIGINS vazio não libera nenhuma origem', async () => {
    const app = await make();
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
