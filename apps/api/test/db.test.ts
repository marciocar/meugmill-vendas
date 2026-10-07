import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const apps: FastifyInstance[] = [];
const dirs: string[] = [];

async function make(databasePath: string): Promise<FastifyInstance> {
  const app = buildApp(
    loadConfig({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      DATABASE_PATH: databasePath,
      OIDC_ISSUER: 'https://idp.test',
      OIDC_AUDIENCE: 'meugmill',
    }),
  );
  apps.push(app);
  await app.ready();
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('banco de dados', () => {
  it('/ready responde 200 com :memory:', async () => {
    const app = await make(':memory:');
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready' });
  });

  it('/ready responde 503 sem vazar detalhes quando o banco falha', async () => {
    const app = await make(':memory:');
    app.sqlite.close();
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable' });
  });

  it('ativa foreign_keys', async () => {
    const app = await make(':memory:');
    expect(app.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('a migration cria service_meta', async () => {
    const app = await make(':memory:');
    const row = app.sqlite
      .prepare("select name from sqlite_master where type = 'table' and name = 'service_meta'")
      .get();
    expect(row).toEqual({ name: 'service_meta' });
  });

  it('usa WAL em arquivo e cria o diretório pai', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'carteira-'));
    dirs.push(dir);
    const app = await make(join(dir, 'sub', 'db.sqlite'));
    expect(app.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('app.close() fecha o banco', async () => {
    const app = await make(':memory:');
    expect(app.sqlite.open).toBe(true);
    await app.close();
    expect(app.sqlite.open).toBe(false);
  });
});
