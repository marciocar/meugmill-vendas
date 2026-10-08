import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

const ISSUER = 'https://idp.test';
const AUDIENCE = 'meugmill';

const PATHS = [
  '/v1/product-subgroups',
  '/v1/retail-networks',
  '/v1/economic-groups',
  '/v1/branches',
  '/v1/geo/states',
  '/v1/sellers',
  '/v1/customers',
  '/v1/portfolio-types',
  '/v1/portfolios',
  '/v1/link-events',
  '/v1/me/visibility',
  '/v1/me/customers',
];

// Rotas aninhadas da carteira: 401 sem token; 404 (carteira inexistente) com token de leitor.
const PORTFOLIO_SUBPATHS = [
  'preview',
  'overrides',
  'assignments',
  'assignments/summary',
  'links',
  'links/history',
];

describe('buildApp: rotas v1 registradas', () => {
  let app: FastifyInstance;
  let auth: { authorization: string };

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }],
    });
    const config = loadConfig({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: AUDIENCE,
    });
    app = buildApp(config, { keyGetter: jwks });
    await app.ready();
    const jwt = await new SignJWT({ roles: ['supervisao'], branch_ids: [] })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('leitor-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    auth = { authorization: `Bearer ${jwt}` };
  });
  afterAll(() => app.close());

  it.each(PATHS)('%s: 401 sem token e 200 com token de leitor', async (url) => {
    const anon = await app.inject({ method: 'GET', url });
    expect(anon.statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url, headers: auth });
    expect(ok.statusCode).toBe(200);
  });

  it.each(PORTFOLIO_SUBPATHS)(
    '/v1/portfolios/{id}/%s: 401 sem token e 404 para carteira inexistente',
    async (sub) => {
      const url = `/v1/portfolios/99999/${sub}`;
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: auth })).statusCode).toBe(404);
    },
  );

  it('POST /v1/portfolios/{id}/distribute: 401 sem token e 404 para carteira inexistente', async () => {
    const url = '/v1/portfolios/99999/distribute';
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url, headers: { ...auth, 'if-match': '"1"' } });
    expect(res.statusCode).toBe(404);
  });

  it('POST /v1/portfolios/{id}/finalize: 401 sem token e 404 para carteira inexistente', async () => {
    const url = '/v1/portfolios/99999/finalize';
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url, headers: { ...auth, 'if-match': '"1"' } });
    expect(res.statusCode).toBe(404);
  });

  it('POST /v1/visibility/check: 401 sem token e 200 com token de leitor', async () => {
    const url = '/v1/visibility/check';
    const payload = { customerIds: [1] };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url, payload, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ visible: [] });
  });

  it('/v1/me segue respondendo 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sub: 'leitor-1', roles: ['supervisao'] });
  });
});
