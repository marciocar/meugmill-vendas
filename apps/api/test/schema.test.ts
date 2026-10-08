import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const apps: FastifyInstance[] = [];

async function make(): Promise<FastifyInstance> {
  const app = buildApp(
    loadConfig({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
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
});

const SERRA = 3205002;
const NOW = 1_700_000_000_000;

function count(app: FastifyInstance, table: string): number {
  const row = app.sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number };
  return row.n;
}

function insertBranch(app: FastifyInstance, code: string): number {
  const res = app.sqlite
    .prepare(
      `insert into branches (code, name, municipality_code, created_at, updated_at, created_by, updated_by)
       values (?, 'Filial', ?, ?, ?, 'tester', 'tester')`,
    )
    .run(code, SERRA, NOW, NOW);
  return Number(res.lastInsertRowid);
}

function insertCustomer(app: FastifyInstance, cnpj: string, municipalityCode = SERRA): number {
  const res = app.sqlite
    .prepare(
      `insert into customers (cnpj, legal_name, state_code, municipality_code, neighborhood,
         neighborhood_key, created_at, updated_at, created_by, updated_by)
       values (?, 'Cliente', 32, ?, 'Centro', 'CENTRO', ?, ?, 'tester', 'tester')`,
    )
    .run(cnpj, municipalityCode, NOW, NOW);
  return Number(res.lastInsertRowid);
}

describe('schema do E2', () => {
  it('cria todas as tabelas', async () => {
    const app = await make();
    const names = (
      app.sqlite.prepare("select name from sqlite_master where type = 'table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const table of [
      'states',
      'municipalities',
      'branches',
      'product_subgroups',
      'retail_networks',
      'economic_groups',
      'sellers',
      'seller_branches',
      'customers',
      'customer_branches',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('carrega o seed IBGE', async () => {
    const app = await make();
    expect(count(app, 'states')).toBe(27);
    const municipalities = count(app, 'municipalities');
    expect(municipalities).toBeGreaterThanOrEqual(5560);
    expect(municipalities).toBeLessThanOrEqual(5580);
    const serra = app.sqlite
      .prepare('select name, state_code from municipalities where ibge_code = ?')
      .get(SERRA);
    expect(serra).toEqual({ name: 'Serra', state_code: 32 });
    expect(app.sqlite.prepare('select uf from states where ibge_code = 32').get()).toEqual({
      uf: 'ES',
    });
  });

  it('rejeita cliente com município inexistente (FK)', async () => {
    const app = await make();
    expect(() => insertCustomer(app, '11222333000181', 9999999)).toThrow(/FOREIGN KEY/);
  });

  it('rejeita código de filial duplicado', async () => {
    const app = await make();
    insertBranch(app, 'SER');
    expect(() => insertBranch(app, 'SER')).toThrow(/UNIQUE/);
  });

  it('rejeita CNPJ duplicado', async () => {
    const app = await make();
    insertCustomer(app, '11222333000181');
    expect(() => insertCustomer(app, '11222333000181')).toThrow(/UNIQUE/);
  });

  it('apagar o cliente remove os vínculos com filiais (cascade)', async () => {
    const app = await make();
    const branchId = insertBranch(app, 'SER');
    const customerId = insertCustomer(app, '11222333000181');
    app.sqlite
      .prepare('insert into customer_branches (customer_id, branch_id) values (?, ?)')
      .run(customerId, branchId);
    expect(count(app, 'customer_branches')).toBe(1);

    app.sqlite.prepare('delete from customers where id = ?').run(customerId);

    expect(count(app, 'customer_branches')).toBe(0);
    expect(count(app, 'branches')).toBe(1);
  });
});
