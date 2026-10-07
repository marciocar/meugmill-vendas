import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function make(): Promise<{ app: FastifyInstance; lines: string[] }> {
  const lines: string[] = [];
  const app = buildApp(
    loadConfig({
      LOG_LEVEL: 'info',
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      OIDC_ISSUER: 'https://idp.test',
      OIDC_AUDIENCE: 'meugmill',
      OIDC_JWKS_URI: 'http://127.0.0.1:1/jwks',
    }),
    { logStream: { write: (chunk) => void lines.push(chunk) } },
  );
  app.get('/boom', async () => {
    throw new Error('segredo interno do banco');
  });
  apps.push(app);
  await app.ready();
  return { app, lines };
}

const parse = (lines: string[]): Record<string, unknown>[] =>
  lines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe('observabilidade', () => {
  it('não registra o token do Authorization no log', async () => {
    const { app, lines } = await make();
    const token = 'eyJ.SEGREDO-DO-TOKEN.assinatura';
    const res = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(401);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain('SEGREDO-DO-TOKEN');
  });

  it('ecoa e loga um x-request-id válido', async () => {
    const { app, lines } = await make();
    const res = await app.inject({ url: '/health', headers: { 'x-request-id': 'abc-123_X.y' } });
    expect(res.headers['x-request-id']).toBe('abc-123_X.y');
    expect(parse(lines).some((l) => l.reqId === 'abc-123_X.y')).toBe(true);
  });

  it.each([['com espaços'], ['a'.repeat(300)], ['inválido/<script>']])(
    'substitui x-request-id inválido (%s)',
    async (bad) => {
      const { app, lines } = await make();
      const res = await app.inject({ url: '/health', headers: { 'x-request-id': bad } });
      const id = res.headers['x-request-id'];
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(parse(lines).every((l) => l.reqId === id)).toBe(true);
    },
  );

  it('inclui x-request-id na resposta 401 e 404', async () => {
    const { app } = await make();
    expect((await app.inject({ url: '/v1/me' })).headers['x-request-id']).toBeTruthy();
    const nf = await app.inject({ url: '/nao-existe' });
    expect(nf.statusCode).toBe(404);
    expect(nf.headers['x-request-id']).toBeTruthy();
  });

  it('expõe x-request-id no CORS', async () => {
    const app = buildApp(
      loadConfig({
        LOG_LEVEL: 'silent',
        DATABASE_PATH: ':memory:',
        OIDC_ISSUER: 'https://idp.test',
        OIDC_AUDIENCE: 'meugmill',
        CORS_ORIGINS: 'https://app.test',
      }),
    );
    apps.push(app);
    const res = await app.inject({ url: '/health', headers: { origin: 'https://app.test' } });
    expect(res.headers['access-control-expose-headers']).toContain('x-request-id');
  });

  it('não registra a query string crua', async () => {
    const { app, lines } = await make();
    await app.inject({ url: '/health?token=abc&cpf=12345678900' });
    const out = lines.join('');
    expect(out).not.toContain('token=abc');
    expect(out).not.toContain('12345678900');
    expect(parse(lines).some((l) => (l.req as { url?: string } | undefined)?.url === '/health')).toBe(true);
  });

  it('erro 5xx responde internal_error sem stack e loga com reqId', async () => {
    const { app, lines } = await make();
    const res = await app.inject({ url: '/boom', headers: { 'x-request-id': 'req-boom' } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal_error' });
    expect(res.body).not.toContain('segredo');
    expect(res.body).not.toContain('at ');
    expect(parse(lines).some((l) => l.level === 50 && l.reqId === 'req-boom')).toBe(true);
  });
});
