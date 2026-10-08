import { DrizzleQueryError } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { safePath } from '../../src/plugins/observability.js';
import { v1Routes } from '../../src/routes/v1/index.js';
import { makeRoutesFixture, READER } from '../helpers/jwt.js';

const CNPJ = '11.222.333/0001-81';
const NAME = 'Farmácia Segredo Ltda';

// Tabela que não existe no banco: o insert falha em SQL real e o Drizzle embrulha em DrizzleQueryError.
const ghost = sqliteTable('tabela_inexistente', { cnpj: text('cnpj'), name: text('name') });

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
      OIDC_ALLOW_INSECURE_HTTP: 'true',
    }),
    { logStream: { write: (chunk) => void lines.push(chunk) } },
  );
  apps.push(app);
  return { app, lines };
}

describe('log de erro 5xx', () => {
  it('erro real de SQL via Drizzle não vaza parâmetros nem SQL no log (better-sqlite3 não embrulha em DrizzleQueryError)', async () => {
    const { app, lines } = await make();
    app.get('/sql-boom', async () => await app.db.insert(ghost).values({ cnpj: CNPJ, name: NAME }));
    await app.ready();

    const res = await app.inject({ url: '/sql-boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal_error' });

    const out = lines.join('');
    expect(out).not.toContain(CNPJ);
    expect(out).not.toContain('11.222.333');
    expect(out).not.toContain(NAME);
    expect(out).not.toContain('params');
    expect(out).not.toContain('tabela_inexistente');
    const entry = lines
      .map((l) => JSON.parse(l) as { level: number; err?: { name?: string; stack?: string } })
      .find((l) => l.level === 50);
    expect(entry?.err?.name).toBeTruthy();
    expect(entry?.err?.stack).toContain('    at ');
  });

  it('DrizzleQueryError (message com params, query/params/cause) também é limpo', async () => {
    const { app, lines } = await make();
    app.get('/fake-boom', async () => {
      throw new DrizzleQueryError(
        'insert into customers values (?, ?)',
        [CNPJ, NAME],
        Object.assign(new Error(`UNIQUE failed ${CNPJ}`), { code: 'SQLITE_CONSTRAINT' }),
      );
    });
    await app.ready();
    const res = await app.inject({ url: '/fake-boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal_error' });
    const out = lines.join('');
    for (const s of [CNPJ, NAME, 'params', 'insert into', 'UNIQUE failed']) expect(out).not.toContain(s);
    const entry = lines
      .map((l) => JSON.parse(l) as { level: number; err?: Record<string, unknown> })
      .find((l) => l.level === 50);
    expect(entry?.err).toMatchObject({ name: 'Error', causeCode: 'SQLITE_CONSTRAINT' });
  });
});

describe('safePath', () => {
  it.each([
    ['/v1/customers/by-cnpj/11222333000181/branches', '/v1/customers/by-cnpj/:cnpj/...'],
    ['/v1/customers/by-cnpj/11.222.333/0001-81/branches', '/v1/customers/by-cnpj/:cnpj/...'],
    ['/v1/customers/by-cnpj/11.222.333%2F0001-81/branches?x=1', '/v1/customers/by-cnpj/:cnpj/...'],
    ['/v1/sellers/by-code/V123/branches', '/v1/sellers/by-code/:code/...'],
    ['/v1/geo/states?x=1', '/v1/geo/states'],
  ])('%s -> %s', (url, expected) => {
    expect(safePath(url)).toBe(expected);
  });

  it('barra do CNPJ sem codificar: 404 e nenhum trecho do CNPJ no log', async () => {
    const fx = await makeRoutesFixture(v1Routes);
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/customers/by-cnpj/11.222.333/0001-81/branches',
        headers: await fx.headers(READER),
        payload: { branchId: 1 },
      });
      expect(res.statusCode).toBe(404);
      const out = fx.logs.join('');
      expect(out).not.toContain('0001-81');
      expect(out).not.toContain('11.222.333');
    } finally {
      await fx.close();
    }
  });

  it('caminho válido: CNPJ mascarado no log', async () => {
    const fx = await makeRoutesFixture(v1Routes);
    try {
      await fx.app.inject({
        method: 'POST',
        url: '/v1/customers/by-cnpj/11222333000181/branches',
        headers: await fx.headers(READER),
        payload: { branchId: 1 },
      });
      const out = fx.logs.join('');
      expect(out).not.toContain('11222333000181');
      expect(out).toContain('/v1/customers/by-cnpj/:cnpj/...');
    } finally {
      await fx.close();
    }
  });
});
