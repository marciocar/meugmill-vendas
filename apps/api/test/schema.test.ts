import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
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

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

function runMigration(sqlite: Database.Database, file: string): void {
  const text = readFileSync(resolve(MIGRATIONS, file), 'utf8');
  for (const statement of text.split('--> statement-breakpoint')) sqlite.exec(statement);
}

describe('migration 0003 (vínculo com estado e chaves de busca)', () => {
  it('vínculos têm estado e os índices (branch_id, dono) substituem os por filial', async () => {
    const app = await make();
    for (const [table, owner] of [
      ['customer_branches', 'customer_id'],
      ['seller_branches', 'seller_id'],
    ] as const) {
      const cols = (app.sqlite.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols).toEqual(expect.arrayContaining(['active', 'deactivated_at', 'updated_at', 'updated_by']));
      const indexes = (app.sqlite.prepare(`pragma index_list(${table})`).all() as { name: string }[]).map(
        (i) => i.name,
      );
      const byBranch = indexes.find((n) => n.includes('branch_id'));
      expect(indexes).not.toContain(`${table}_branch_id_idx`);
      const idx = app.sqlite.prepare(`pragma index_info(${byBranch})`).all() as { name: string }[];
      expect(idx.map((c) => c.name)).toEqual(['branch_id', owner]);
    }
  });

  it('a listagem com escopo usa o índice (branch_id, dono) como cobertura', async () => {
    const app = await make();
    const plan = app.sqlite
      .prepare(
        `explain query plan
         select * from customers
         where id in (select customer_id from customer_branches where branch_id in (1, 2))
           and id > 0
         order by id limit 51`,
      )
      .all() as { detail: string }[];
    const details = plan.map((p) => p.detail).join(' | ');
    expect(details).toContain('USING COVERING INDEX customer_branches_branch_id_customer_id_idx');
  });

  it('backfill: linhas existentes ganham chaves sem acento e vínculos ativos', () => {
    const sqlite = new Database(':memory:');
    try {
      runMigration(sqlite, '0000_fearless_sunfire.sql');
      runMigration(sqlite, '0001_e2_master_data.sql');
      sqlite.exec(
        `insert into states (ibge_code, uf, name) values (32, 'ES', 'Espírito Santo');
         insert into municipalities (ibge_code, name, state_code) values (${SERRA}, 'Serra', 32);
         insert into branches (code, name, municipality_code, created_at, updated_at, created_by, updated_by)
           values ('SER', 'Filial Vitória Ação', ${SERRA}, ${NOW}, ${NOW}, 't', 't');
         insert into sellers (code, name, created_at, updated_at, created_by, updated_by)
           values ('V1', 'José da Conceição', ${NOW}, ${NOW}, 't', 't');
         insert into customers (cnpj, legal_name, trade_name, state_code, municipality_code, neighborhood,
           neighborhood_key, created_at, updated_at, created_by, updated_by)
           values ('11222333000181', 'DROGARIA SÃO JOSÉ Ltda', 'Farmácia Ímpar', 32, ${SERRA}, 'Centro',
           'CENTRO', ${NOW}, ${NOW}, 't', 't');
         insert into customers (cnpj, legal_name, state_code, municipality_code, neighborhood,
           neighborhood_key, created_at, updated_at, created_by, updated_by)
           values ('11444777000161', 'Sem Fantasia', 32, ${SERRA}, 'Centro', 'CENTRO', ${NOW}, ${NOW}, 't', 't');
         insert into customer_branches (customer_id, branch_id) values (1, 1);
         insert into seller_branches (seller_id, branch_id) values (1, 1);`,
      );
      runMigration(sqlite, '0003_e2_link_state_search_keys.sql');
      const one = <T>(q: string) => sqlite.prepare(q).get() as T;
      expect(one<{ k: string }>('select name_key as k from branches').k).toBe('FILIAL VITORIA ACAO');
      expect(one<{ k: string }>('select name_key as k from sellers').k).toBe('JOSE DA CONCEICAO');
      expect(
        sqlite.prepare('select legal_name_key as l, trade_name_key as t from customers order by id').all(),
      ).toEqual([
        { l: 'DROGARIA SAO JOSE LTDA', t: 'FARMACIA IMPAR' },
        { l: 'SEM FANTASIA', t: null },
      ]);
      expect(one<{ active: number }>('select active from customer_branches').active).toBe(1);
      expect(one<{ active: number }>('select active from seller_branches').active).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
