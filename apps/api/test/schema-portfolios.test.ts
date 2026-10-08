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
const VITORIA = 3205309;
const ES = 32;
const NOW = 1_700_000_000_000;
const AUDIT = `${NOW}, ${NOW}, 't', 't'`;

function count(app: FastifyInstance, table: string): number {
  return (app.sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
}

function insertId(app: FastifyInstance, sql: string, ...params: unknown[]): number {
  return Number(app.sqlite.prepare(sql).run(...params).lastInsertRowid);
}

function branch(app: FastifyInstance, code: string): number {
  return insertId(
    app,
    `insert into branches (code, name, municipality_code, created_at, updated_at, created_by, updated_by)
     values (?, 'Filial', ?, ${AUDIT})`,
    code,
    SERRA,
  );
}

function portfolioType(app: FastifyInstance, code = 'T1'): number {
  return insertId(
    app,
    `insert into portfolio_types (code, name, name_key, created_at, updated_at, created_by, updated_by)
     values (?, 'Tipo', 'TIPO', ${AUDIT})`,
    code,
  );
}

function portfolio(
  app: FastifyInstance,
  branchId: number,
  typeId: number,
  nameKey = 'NORTE',
  status = 'draft',
): number {
  return insertId(
    app,
    `insert into portfolios (branch_id, name, name_key, responsible_sub, portfolio_type_id, status,
       created_at, updated_at, created_by, updated_by)
     values (?, ?, ?, 'sub-1', ?, ?, ${AUDIT})`,
    branchId,
    nameKey,
    nameKey,
    typeId,
    status,
  );
}

function region(
  app: FastifyInstance,
  portfolioId: number,
  level: string,
  municipality: number | null,
  key: string | null,
  label: string | null = key,
): number {
  return insertId(
    app,
    `insert into portfolio_regions (portfolio_id, level, state_code, municipality_code,
       neighborhood_key, neighborhood_label) values (?, ?, ?, ?, ?, ?)`,
    portfolioId,
    level,
    ES,
    municipality,
    key,
    label,
  );
}

function setup(app: FastifyInstance) {
  const branchId = branch(app, 'SER');
  const typeId = portfolioType(app);
  return { branchId, typeId, portfolioId: portfolio(app, branchId, typeId) };
}

describe('schema do E3 (carteiras)', () => {
  it('cria as tabelas', async () => {
    const app = await make();
    const names = (
      app.sqlite.prepare("select name from sqlite_master where type = 'table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const t of [
      'portfolio_types',
      'portfolios',
      'portfolio_regions',
      'portfolio_retail_networks',
      'portfolio_economic_groups',
      'portfolio_sellers',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('status padrão é draft e valor inválido falha', async () => {
    const app = await make();
    const { branchId, typeId, portfolioId } = setup(app);
    expect(app.sqlite.prepare('select status from portfolios where id = ?').get(portfolioId)).toEqual({
      status: 'draft',
    });
    expect(() => portfolio(app, branchId, typeId, 'SUL', 'archived')).toThrow(/CHECK/);
    expect(portfolio(app, branchId, typeId, 'SUL', 'active')).toBeGreaterThan(0);
  });

  it('nome duplicado na mesma filial falha; em outra filial passa', async () => {
    const app = await make();
    const { branchId, typeId } = setup(app);
    expect(() => portfolio(app, branchId, typeId, 'NORTE')).toThrow(/UNIQUE/);
    const other = branch(app, 'VIT');
    expect(portfolio(app, other, typeId, 'NORTE')).toBeGreaterThan(0);
  });

  it('código de tipo duplicado falha', async () => {
    const app = await make();
    portfolioType(app, 'X');
    expect(() => portfolioType(app, 'X')).toThrow(/UNIQUE/);
  });

  it('FKs inexistentes falham', async () => {
    const app = await make();
    const { branchId, typeId, portfolioId } = setup(app);
    expect(() => portfolio(app, 999, typeId, 'A')).toThrow(/FOREIGN KEY/);
    expect(() => portfolio(app, branchId, 999, 'B')).toThrow(/FOREIGN KEY/);
    expect(() =>
      app.sqlite.prepare('insert into portfolio_sellers values (?, 999, 999)').run(portfolioId),
    ).toThrow(/FOREIGN KEY/);
    const seller = insertId(
      app,
      `insert into sellers (code, name, created_at, updated_at, created_by, updated_by)
       values ('V1', 'Vendedor', ${AUDIT})`,
    );
    expect(() =>
      app.sqlite.prepare('insert into portfolio_sellers values (?, ?, 999)').run(portfolioId, seller),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      app.sqlite.prepare('insert into portfolio_retail_networks values (?, 999)').run(portfolioId),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      app.sqlite.prepare('insert into portfolio_economic_groups values (?, 999)').run(portfolioId),
    ).toThrow(/FOREIGN KEY/);
    expect(() => region(app, 999, 'state', null, null)).toThrow(/FOREIGN KEY/);
  });

  describe('regiões', () => {
    it('aceita os três níveis coerentes', async () => {
      const app = await make();
      const { portfolioId } = setup(app);
      region(app, portfolioId, 'state', null, null);
      region(app, portfolioId, 'municipality', SERRA, null);
      region(app, portfolioId, 'neighborhood', SERRA, 'CENTRO', 'Centro');
      expect(count(app, 'portfolio_regions')).toBe(3);
    });

    it('CHECK de coerência por nível', async () => {
      const app = await make();
      const { portfolioId } = setup(app);
      // state com município
      expect(() => region(app, portfolioId, 'state', SERRA, null)).toThrow(/CHECK/);
      // state com bairro
      expect(() => region(app, portfolioId, 'state', null, 'X', 'X')).toThrow(/CHECK/);
      // municipality sem município
      expect(() => region(app, portfolioId, 'municipality', null, null)).toThrow(/CHECK/);
      // municipality com bairro
      expect(() => region(app, portfolioId, 'municipality', SERRA, 'X', 'X')).toThrow(/CHECK/);
      // neighborhood sem chave, com chave vazia, sem rótulo e sem município
      expect(() => region(app, portfolioId, 'neighborhood', SERRA, null, null)).toThrow(/CHECK/);
      expect(() => region(app, portfolioId, 'neighborhood', SERRA, '', 'Centro')).toThrow(/CHECK/);
      expect(() => region(app, portfolioId, 'neighborhood', SERRA, 'CENTRO', null)).toThrow(/CHECK/);
      expect(() => region(app, portfolioId, 'neighborhood', null, 'CENTRO', 'Centro')).toThrow(/CHECK/);
      // nível desconhecido
      expect(() => region(app, portfolioId, 'country', null, null)).toThrow(/CHECK/);
      expect(count(app, 'portfolio_regions')).toBe(0);
    });

    it('duplicata de UF, município e bairro no mesmo portfolio falha', async () => {
      const app = await make();
      const { portfolioId, branchId, typeId } = setup(app);
      region(app, portfolioId, 'state', null, null);
      region(app, portfolioId, 'municipality', SERRA, null);
      region(app, portfolioId, 'neighborhood', SERRA, 'CENTRO', 'Centro');
      expect(() => region(app, portfolioId, 'state', null, null)).toThrow(/UNIQUE/);
      expect(() => region(app, portfolioId, 'municipality', SERRA, null)).toThrow(/UNIQUE/);
      expect(() => region(app, portfolioId, 'neighborhood', SERRA, 'CENTRO', 'CENTRO')).toThrow(/UNIQUE/);
      // variações distintas passam
      region(app, portfolioId, 'municipality', VITORIA, null);
      region(app, portfolioId, 'neighborhood', SERRA, 'LARANJEIRAS', 'Laranjeiras');
      region(app, portfolioId, 'neighborhood', VITORIA, 'CENTRO', 'Centro');
      // mesma região em outro portfolio passa
      const other = portfolio(app, branchId, typeId, 'SUL');
      region(app, other, 'state', null, null);
      expect(count(app, 'portfolio_regions')).toBe(7);
    });

    it('region_key é gerada pelo banco', async () => {
      const app = await make();
      const { portfolioId } = setup(app);
      region(app, portfolioId, 'neighborhood', SERRA, 'CENTRO', 'Centro');
      expect(app.sqlite.prepare('select region_key as k from portfolio_regions').get()).toEqual({
        k: `neighborhood:${ES}:${SERRA}:CENTRO`,
      });
    });
  });

  it('chaves compostas impedem duplicata nos filtros e vendedores', async () => {
    const app = await make();
    const { portfolioId } = setup(app);
    const net = insertId(
      app,
      `insert into retail_networks (code, name, created_at, updated_at, created_by, updated_by)
       values ('R1', 'Rede', ${AUDIT})`,
    );
    app.sqlite.prepare('insert into portfolio_retail_networks values (?, ?)').run(portfolioId, net);
    expect(() =>
      app.sqlite.prepare('insert into portfolio_retail_networks values (?, ?)').run(portfolioId, net),
    ).toThrow(/UNIQUE/);
  });

  it('apagar o portfolio remove regiões, filtros e vendedores (cascade)', async () => {
    const app = await make();
    const { portfolioId, branchId } = setup(app);
    const net = insertId(
      app,
      `insert into retail_networks (code, name, created_at, updated_at, created_by, updated_by)
       values ('R1', 'Rede', ${AUDIT})`,
    );
    const group = insertId(
      app,
      `insert into economic_groups (code, name, created_at, updated_at, created_by, updated_by)
       values ('G1', 'Grupo', ${AUDIT})`,
    );
    const seller = insertId(
      app,
      `insert into sellers (code, name, created_at, updated_at, created_by, updated_by)
       values ('V1', 'Vendedor', ${AUDIT})`,
    );
    const sub = insertId(
      app,
      `insert into product_subgroups (code, name, created_at, updated_at, created_by, updated_by)
       values ('S1', 'Subgrupo', ${AUDIT})`,
    );
    region(app, portfolioId, 'state', null, null);
    app.sqlite.prepare('insert into portfolio_retail_networks values (?, ?)').run(portfolioId, net);
    app.sqlite.prepare('insert into portfolio_economic_groups values (?, ?)').run(portfolioId, group);
    app.sqlite.prepare('insert into portfolio_sellers values (?, ?, ?)').run(portfolioId, seller, sub);
    // PK composta: mesmo vendedor em outro subgrupo é permitido; repetição não
    expect(() =>
      app.sqlite.prepare('insert into portfolio_sellers values (?, ?, ?)').run(portfolioId, seller, sub),
    ).toThrow(/UNIQUE/);

    app.sqlite.prepare('delete from portfolios where id = ?').run(portfolioId);

    for (const t of [
      'portfolio_regions',
      'portfolio_retail_networks',
      'portfolio_economic_groups',
      'portfolio_sellers',
    ]) {
      expect(count(app, t)).toBe(0);
    }
    // cadastros referenciados permanecem
    expect(count(app, 'retail_networks')).toBe(1);
    expect(count(app, 'sellers')).toBe(1);
    expect(count(app, 'branches')).toBe(1);
    expect(branchId).toBeGreaterThan(0);
  });

  it('índices de consulta existem', async () => {
    const app = await make();
    const idx = (table: string) =>
      (app.sqlite.prepare(`pragma index_list(${table})`).all() as { name: string }[]).map((i) => i.name);
    expect(idx('portfolios')).toEqual(
      expect.arrayContaining(['portfolios_responsible_sub_idx', 'portfolios_portfolio_type_id_idx']),
    );
    expect(idx('portfolio_sellers')).toEqual(
      expect.arrayContaining([
        'portfolio_sellers_seller_id_idx',
        'portfolio_sellers_product_subgroup_id_idx',
      ]),
    );
  });
});

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

describe('migration 0004 (carteiras) sobre banco com dados do E2', () => {
  it('aplica sem alterar os dados existentes', () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.pragma('foreign_keys = ON');
      const run = (file: string) => {
        for (const stmt of readFileSync(resolve(MIGRATIONS, file), 'utf8').split(
          '--> statement-breakpoint',
        )) {
          sqlite.exec(stmt);
        }
      };
      for (const f of [
        '0000_fearless_sunfire.sql',
        '0001_e2_master_data.sql',
        '0002_seed_ibge.sql',
        '0003_e2_link_state_search_keys.sql',
      ]) {
        run(f);
      }
      sqlite.exec(
        `insert into branches (code, name, name_key, municipality_code, created_at, updated_at, created_by, updated_by)
           values ('SER', 'Filial', 'FILIAL', ${SERRA}, ${AUDIT});
         insert into sellers (code, name, name_key, created_at, updated_at, created_by, updated_by)
           values ('V1', 'Vendedor', 'VENDEDOR', ${AUDIT});
         insert into customers (cnpj, legal_name, state_code, municipality_code, neighborhood,
           neighborhood_key, created_at, updated_at, created_by, updated_by)
           values ('11222333000181', 'Cliente', ${ES}, ${SERRA}, 'Centro', 'CENTRO', ${AUDIT});`,
      );

      run('0004_e3_portfolios.sql');

      const n = (t: string) => (sqlite.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n;
      expect([n('branches'), n('sellers'), n('customers')]).toEqual([1, 1, 1]);
      expect(n('portfolios')).toBe(0);
      sqlite.exec(
        `insert into portfolio_types (code, name, name_key, ${'created_at, updated_at, created_by, updated_by'})
           values ('T', 'Tipo', 'TIPO', ${AUDIT});
         insert into portfolios (branch_id, name, name_key, responsible_sub, portfolio_type_id,
           created_at, updated_at, created_by, updated_by) values (1, 'N', 'N', 's', 1, ${AUDIT});`,
      );
      expect(n('portfolios')).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
