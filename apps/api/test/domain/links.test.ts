import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDistributionService } from '../../src/domain/distribution/service.js';
import { createLinkService } from '../../src/domain/links/service.js';
import { createPortfolioService } from '../../src/domain/portfolios/service.js';
import { DomainError } from '../../src/domain/shared/errors.js';
import { neighborhoodKey, searchKey } from '../../src/domain/shared/normalize.js';
import {
  ES,
  SERRA,
  VITORIA,
  actor,
  adminOf,
  codeOf,
  makeFixture,
  readerOf,
  seedBranch,
  type Fixture,
} from '../helpers/seed.js';

const NOW = 1_700_000_000_000;
let clock = NOW;

let fx: Fixture;
let ser: number;
let typeId: number;
let seq = 0;

const sqlite = () => fx.app.sqlite;
const admin = () => adminOf('SER');
const resp = () => actor({ sub: 'resp', roles: ['vendedor'], branches: ['SER'] });
const dist = () => createDistributionService(fx.db, { now: () => clock });
const links = () => createLinkService(fx.db, { now: () => clock });

async function setup(): Promise<void> {
  clock = NOW;
  fx = await makeFixture();
  seq = 0;
  ser = seedBranch(fx.db, 'SER');
  typeId = sqlite()
    .prepare(
      `insert into portfolio_types (code, name, name_key, created_at, updated_at, created_by, updated_by)
       values ('T','Tipo','TIPO',?,?,'t','t')`,
    )
    .run(NOW, NOW).lastInsertRowid as number;
}
beforeEach(setup);
afterEach(async () => {
  await fx.app.close();
});

function customer(o: { municipality?: number; active?: boolean } = {}): number {
  seq += 1;
  const name = `Cliente ${seq}`;
  const id = sqlite()
    .prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
        neighborhood_key, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,?,?,?,?,'t','t')`,
    )
    .run(
      String(seq).padStart(14, '0'),
      name,
      searchKey(name),
      ES,
      o.municipality ?? VITORIA,
      'Centro',
      neighborhoodKey('Centro'),
      o.active === false ? 0 : 1,
      NOW,
      NOW,
    ).lastInsertRowid as number;
  sqlite()
    .prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,1)')
    .run(id, ser);
  return id;
}

function portfolio(name: string): number {
  return sqlite()
    .prepare(
      `insert into portfolios (branch_id, name, name_key, responsible_sub, portfolio_type_id, status, active,
        created_at, updated_at, created_by, updated_by) values (?,?,?,'resp',?,'draft',1,?,?,'t','t')`,
    )
    .run(ser, name, searchKey(name), typeId, NOW, NOW).lastInsertRowid as number;
}
const byState = (p: number) =>
  sqlite()
    .prepare("insert into portfolio_regions (portfolio_id, level, state_code) values (?,'state',?)")
    .run(p, ES);
const byCity = (p: number, m: number) =>
  sqlite()
    .prepare(
      "insert into portfolio_regions (portfolio_id, level, state_code, municipality_code) values (?,'municipality',?,?)",
    )
    .run(p, ES, m);

function subgroup(code: string): number {
  return sqlite()
    .prepare(
      `insert into product_subgroups (code, name, name_key, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,'t','t')`,
    )
    .run(code, `Subgrupo ${code}`, searchKey(code), NOW, NOW).lastInsertRowid as number;
}
function seller(code: string, o: { active?: boolean; linked?: 'active' | 'inactive' | 'none' } = {}): number {
  const id = sqlite()
    .prepare(
      `insert into sellers (code, name, name_key, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,'t','t')`,
    )
    .run(code, `Vendedor ${code}`, searchKey(code), o.active === false ? 0 : 1, NOW, NOW)
    .lastInsertRowid as number;
  const linked = o.linked ?? 'active';
  if (linked !== 'none') {
    sqlite()
      .prepare('insert into seller_branches (seller_id, branch_id, active) values (?,?,?)')
      .run(id, ser, linked === 'active' ? 1 : 0);
  }
  return id;
}
const pair = (p: number, s: number, g: number) =>
  sqlite()
    .prepare('insert into portfolio_sellers (portfolio_id, seller_id, product_subgroup_id) values (?,?,?)')
    .run(p, s, g);

interface LinkRow {
  id: number;
  portfolio_id: number;
  c: number;
  g: number;
  s: number;
  active: number;
  valid_from: number;
  valid_to: number | null;
  created_by: string;
  ended_by: string | null;
}
const linkRows = (p: number): LinkRow[] =>
  sqlite()
    .prepare(
      `select id, portfolio_id, customer_id as c, product_subgroup_id as g, seller_id as s, active, valid_from,
        valid_to, created_by, ended_by from portfolio_links where portfolio_id = ? order by id`,
    )
    .all(p) as LinkRow[];
const activeCells = (p: number) =>
  linkRows(p)
    .filter((l) => l.active === 1)
    .map((l) => ({ c: l.c, g: l.g, s: l.s }))
    .sort((a, b) => a.c - b.c || a.g - b.g);
interface EventRow {
  id: number;
  link_id: number;
  kind: string;
  portfolio_id: number;
  branch_id: number;
  c: number;
  g: number;
  s: number;
  occurred_at: number;
}
const eventRows = (): EventRow[] =>
  sqlite()
    .prepare(
      `select id, link_id, kind, portfolio_id, branch_id, customer_id as c, product_subgroup_id as g,
        seller_id as s, occurred_at from portfolio_link_events order by id`,
    )
    .all() as EventRow[];
const counts = () =>
  sqlite()
    .prepare(
      'select (select count(*) from portfolio_links) as l, (select count(*) from portfolio_link_events) as e',
    )
    .get() as { l: number; e: number };
const row = (p: number) =>
  sqlite()
    .prepare('select status, version, finalized_at, finalized_by from portfolios where id = ?')
    .get(p) as {
    status: string;
    version: number;
    finalized_at: number | null;
    finalized_by: string | null;
  };
const errorOf = (fn: () => unknown): DomainError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error('nenhum erro lançado');
};

/** Carteira P (UF ES), 2 subgrupos (A: g1+g2, B: g1, C: g2), 4 clientes em Vitória, já distribuída (v2). */
function distributed() {
  const p = portfolio('P');
  byState(p);
  const g1 = subgroup('G1');
  const g2 = subgroup('G2');
  const A = seller('A');
  const B = seller('B');
  const C = seller('C');
  pair(p, A, g1);
  pair(p, A, g2);
  pair(p, B, g1);
  pair(p, C, g2);
  const cs = [customer(), customer(), customer(), customer()];
  dist().distribute(admin(), p, 1);
  return { p, g1, g2, A, B, C, cs };
}

describe('finalize: caminho feliz', () => {
  it('cria um vínculo e um evento por célula, ativa a carteira e incrementa a versão', () => {
    const { p, cs } = distributed();
    const r = links().finalize(admin(), p, 2);
    expect(r).toMatchObject({ created: 8, ended: 0, kept: 0 });
    expect(r.aggregate.status).toBe('active');
    expect(r.aggregate.version).toBe(3);
    expect(row(p)).toEqual({ status: 'active', version: 3, finalized_at: NOW, finalized_by: 'user-1' });
    const rows = linkRows(p);
    expect(rows).toHaveLength(8);
    expect(rows.every((l) => l.active === 1 && l.valid_from === NOW && l.valid_to === null)).toBe(true);
    expect(rows.every((l) => l.created_by === 'user-1' && l.ended_by === null)).toBe(true);
    expect(new Set(rows.map((l) => l.c))).toEqual(new Set(cs));
    // Os vínculos espelham as atribuições gravadas.
    const stored = sqlite()
      .prepare(
        'select customer_id as c, product_subgroup_id as g, seller_id as s from portfolio_assignments where portfolio_id = ? order by 1, 2',
      )
      .all(p);
    expect(activeCells(p)).toEqual(stored);
    const ev = eventRows();
    expect(ev).toHaveLength(8);
    expect(ev.every((e) => e.kind === 'created' && e.portfolio_id === p && e.occurred_at === NOW)).toBe(true);
    expect(ev.map((e) => e.link_id)).toEqual(rows.map((l) => l.id));
    expect(ev.map((e) => [e.c, e.g, e.s])).toEqual(rows.map((l) => [l.c, l.g, l.s]));
  });

  it('re-finalizar sem mudanças não grava nada nem muda a versão', () => {
    const { p } = distributed();
    links().finalize(admin(), p, 2);
    clock += 1000;
    const before = counts();
    const r = links().finalize(admin(), p, 3);
    expect(r).toMatchObject({ created: 0, ended: 0, kept: 8 });
    expect(r.aggregate.version).toBe(3);
    expect(counts()).toEqual(before);
    expect(row(p).finalized_at).toBe(NOW);
  });

  it('carteira sem membros finaliza vazia (rascunho vira ativa)', () => {
    const p = portfolio('Vazia');
    byState(p);
    const r = links().finalize(admin(), p, 1);
    expect(r).toMatchObject({ created: 0, ended: 0, kept: 0 });
    expect(r.aggregate.status).toBe('active');
    expect(r.aggregate.version).toBe(2);
  });
});

describe('finalize: recusas de regra', () => {
  it('incompleta (unassigned e stale): 409 com contagens e nada gravado', () => {
    const { p, g1, C, cs } = distributed();
    dist().replaceAssignments(admin(), p, 2, {
      clear: [{ customerId: cs[0] as number, productSubgroupId: g1 }],
    });
    const err = errorOf(() => links().finalize(admin(), p, 3));
    expect(err.code).toBe('portfolio_incomplete');
    expect(err.status).toBe(409);
    expect(err.detail).toEqual({ unassigned: 1, stale: 0 });
    // C atende só g2: inativá-lo deixa stale as células de g2 que lhe couberam.
    const withC = (
      sqlite()
        .prepare('select count(*) as n from portfolio_assignments where portfolio_id = ? and seller_id = ?')
        .get(p, C) as { n: number }
    ).n;
    expect(withC).toBeGreaterThan(0);
    sqlite().prepare('update sellers set active = 0 where id = ?').run(C);
    const err2 = errorOf(() => links().finalize(admin(), p, 3));
    expect(err2.detail).toEqual({ unassigned: 1, stale: withC });
    expect(counts()).toEqual({ l: 0, e: 0 });
    expect(row(p)).toMatchObject({ status: 'draft', version: 3 });
  });

  it('stale gravada fora da grade não impede a finalização nem gera vínculo', () => {
    const { p, g1, A, cs } = distributed();
    const out = customer({ municipality: SERRA });
    sqlite().prepare("insert into portfolio_assignments values (?,?,?,?,1,'t',1,'t')").run(p, out, g1, A);
    byCity(portfolio('Rival'), SERRA); // tira o cliente de Serra da grade de P
    const r = links().finalize(admin(), p, 2);
    expect(r.created).toBe(cs.length * 2);
    expect(linkRows(p).some((l) => l.c === out)).toBe(false);
  });

  it('com clientes bloqueados: 409 portfolio_has_conflicts com a contagem, sem dados de cliente', () => {
    const { p } = distributed();
    byState(portfolio('Empate')); // mesmo posto: os 4 clientes ficam bloqueados nas duas
    const err = errorOf(() => links().finalize(admin(), p, 2));
    expect(err.code).toBe('portfolio_has_conflicts');
    expect(err.status).toBe(409);
    expect(err.detail).toEqual({ blocked: 4 });
    expect(err.message).not.toMatch(/Cliente|0000000/);
    expect(counts()).toEqual({ l: 0, e: 0 });
    expect(row(p).status).toBe('draft');
  });
});

describe('finalize: diff na re-finalização', () => {
  it('troca de vendedor de uma célula: 1 encerrado, 1 criado, o resto mantido; histórico preservado', () => {
    const { p, g1, A, B, cs } = distributed();
    links().finalize(admin(), p, 2);
    const target = cs[0] as number;
    const old = linkRows(p).find((l) => l.c === target && l.g === g1) as LinkRow;
    const next = old.s === A ? B : A;
    dist().replaceAssignments(admin(), p, 3, {
      set: [{ customerId: target, productSubgroupId: g1, sellerId: next }],
    });
    clock += 5000;
    const r = links().finalize(resp(), p, 4);
    expect(r).toMatchObject({ created: 1, ended: 1, kept: 7 });
    expect(r.aggregate.version).toBe(5);
    expect(row(p)).toMatchObject({ finalized_at: clock, finalized_by: 'resp' });

    const rows = linkRows(p);
    expect(rows).toHaveLength(9);
    const ended = rows.find((l) => l.id === old.id) as LinkRow;
    expect(ended).toMatchObject({ active: 0, valid_to: clock, ended_by: 'resp', s: old.s, valid_from: NOW });
    const created = rows[8] as LinkRow;
    expect(created).toMatchObject({
      c: target,
      g: g1,
      s: next,
      active: 1,
      valid_from: clock,
      created_by: 'resp',
    });
    expect(rows.filter((l) => l.active === 1)).toHaveLength(8);
    expect(
      eventRows()
        .slice(8)
        .map((e) => [e.kind, e.link_id, e.s]),
    ).toEqual([
      ['ended', old.id, old.s],
      ['created', created.id, next],
    ]);

    const hist = links().listLinkHistory(admin(), p, { customerId: target });
    expect(hist.items.filter((i) => i.productSubgroup.id === g1).map((i) => [i.active, i.validTo])).toEqual([
      [false, clock],
      [true, null],
    ]);
  });

  it('cliente que perde a disputa para outra carteira: re-finalizar encerra o vínculo dele', () => {
    const { p, cs } = distributed();
    const near = customer({ municipality: SERRA });
    dist().distribute(admin(), p, 2);
    links().finalize(admin(), p, 3);
    expect(linkRows(p).filter((l) => l.c === near)).toHaveLength(2);
    byCity(portfolio('Rival'), SERRA);
    const r = links().finalize(admin(), p, 4);
    expect(r).toMatchObject({ created: 0, ended: 2, kept: cs.length * 2 });
    expect(
      linkRows(p)
        .filter((l) => l.c === near)
        .every((l) => l.active === 0),
    ).toBe(true);
    expect(
      eventRows()
        .filter((e) => e.kind === 'ended')
        .map((e) => e.c),
    ).toEqual([near, near]);
    expect(activeCells(p).some((l) => l.c === near)).toBe(false);
  });

  it('cliente novo na grade: células novas criadas, as antigas mantidas', () => {
    const { p } = distributed();
    links().finalize(admin(), p, 2);
    const fresh = customer();
    dist().distribute(admin(), p, 3);
    const r = links().finalize(admin(), p, 4);
    expect(r).toMatchObject({ created: 2, ended: 0, kept: 8 });
    expect(activeCells(p).filter((l) => l.c === fresh)).toHaveLength(2);
  });
});

describe('finalize: vínculos entre carteiras da filial', () => {
  /** Q ativa com 3 clientes (UF ES); depois P (só inclusão manual, posto máximo) passa a vencer o cliente x. */
  function setupConflict() {
    const q = portfolio('Q');
    byState(q);
    const g1 = subgroup('G1');
    const A = seller('A');
    pair(q, A, g1);
    const cs = [customer(), customer(), customer()];
    dist().distribute(admin(), q, 1);
    links().finalize(admin(), q, 2); // Q fica na v3
    const p = portfolio('P');
    pair(p, A, g1);
    const x = cs[0] as number;
    sqlite().prepare("insert into portfolio_customer_overrides values (?,?,'include',1,'t')").run(p, x);
    dist().distribute(admin(), p, 1);
    return { q, p, g1, A, cs, x };
  }

  it('link_conflict lista a carteira que ainda mantém o vínculo; re-finalizar a outra libera', () => {
    const { q, p, x } = setupConflict();
    const before = counts();
    const err = errorOf(() => links().finalize(admin(), p, 2));
    expect(err.code).toBe('link_conflict');
    expect(err.status).toBe(409);
    expect(err.detail).toEqual({ portfolioIds: [q] });
    expect(counts()).toEqual(before);
    expect(row(p).status).toBe('draft');

    // Q perdeu x na disputa: re-finalizar Q encerra o vínculo dele (e só ele).
    const rq = links().finalize(admin(), q, 3);
    expect(rq).toMatchObject({ created: 0, ended: 1, kept: 2 });
    expect(linkRows(q).find((l) => l.c === x)?.active).toBe(0);

    const rp = links().finalize(admin(), p, 2);
    expect(rp).toMatchObject({ created: 1, ended: 0, kept: 0 });
    expect(activeCells(p).map((l) => l.c)).toEqual([x]);
  });

  it('o índice parcial impede dois ativos na mesma (filial, cliente, subgrupo), mas admite histórico', () => {
    const { q, p, g1, A, x } = setupConflict();
    const ins = (portfolioId: number, active: number) =>
      sqlite()
        .prepare(
          `insert into portfolio_links (portfolio_id, branch_id, customer_id, product_subgroup_id, seller_id,
            active, valid_from, created_by) values (?,?,?,?,?,?,1,'t')`,
        )
        .run(portfolioId, ser, x, g1, A, active);
    expect(() => ins(p, 1)).toThrow(/UNIQUE/);
    expect(() => ins(q, 1)).toThrow(/UNIQUE/);
    expect(() => ins(p, 0)).not.toThrow();
    expect(() => ins(p, 0)).not.toThrow();
    const ddl = (
      sqlite()
        .prepare("select sql from sqlite_master where name = 'portfolio_links_active_cell_unique'")
        .get() as { sql: string }
    ).sql;
    expect(ddl).toMatch(/WHERE .*active.* = 1/);
  });
});

describe('inativar e reativar a carteira', () => {
  it('inativar encerra todos os vínculos ativos com eventos; reativar não recria', () => {
    const { p } = distributed();
    links().finalize(admin(), p, 2);
    clock += 100;
    const portfolios = createPortfolioService(fx.db, { now: () => clock });
    const agg = portfolios.deactivate(admin(), p, 3);
    expect(agg.active).toBe(false);
    const rows = linkRows(p);
    expect(rows).toHaveLength(8);
    expect(rows.every((l) => l.active === 0 && l.valid_to === clock && l.ended_by === 'user-1')).toBe(true);
    const ev = eventRows();
    expect(ev).toHaveLength(16);
    expect(ev.slice(8).every((e) => e.kind === 'ended' && e.occurred_at === clock)).toBe(true);
    expect(ev.slice(8).map((e) => e.link_id)).toEqual(rows.map((l) => l.id));

    portfolios.reactivate(admin(), p, 4);
    expect(counts()).toEqual({ l: 8, e: 16 });
    // Finalizar de novo recria (o status segue active, mas as células estão sem vínculo).
    const r = links().finalize(admin(), p, 5);
    expect(r).toMatchObject({ created: 8, ended: 0, kept: 0 });
    expect(linkRows(p).filter((l) => l.active === 1)).toHaveLength(8);
  });

  it('inativar rascunho (sem vínculos) não grava eventos', () => {
    const { p } = distributed();
    createPortfolioService(fx.db).deactivate(admin(), p, 2);
    expect(counts()).toEqual({ l: 0, e: 0 });
  });
});

describe('permissões, versão e atomicidade', () => {
  it('leitor 403 e responsável ok; fora do escopo 404', () => {
    const { p } = distributed();
    expect(codeOf(() => links().finalize(readerOf('SER'), p, 2))).toBe('forbidden');
    expect(codeOf(() => links().finalize(adminOf('XXX'), p, 2))).toBe('not_found');
    expect(counts()).toEqual({ l: 0, e: 0 });
    expect(links().finalize(resp(), p, 2).created).toBe(8);
  });

  it('sem versão 428, versão velha 409, inativa 409 (inativa vem antes da versão)', () => {
    const { p } = distributed();
    expect(codeOf(() => links().finalize(admin(), p, undefined))).toBe('precondition_required');
    expect(codeOf(() => links().finalize(admin(), p, 7))).toBe('version_conflict');
    createPortfolioService(fx.db).deactivate(admin(), p, 2);
    expect(codeOf(() => links().finalize(admin(), p, 3))).toBe('portfolio_inactive');
    expect(codeOf(() => links().finalize(admin(), p, 99))).toBe('portfolio_inactive');
    expect(counts()).toEqual({ l: 0, e: 0 });
  });

  it('falha no meio do lote não deixa vínculos, eventos nem mudança de estado', () => {
    const { p, g1, A, B, cs } = distributed();
    links().finalize(admin(), p, 2); // base: 8 vínculos, v3
    const base = counts();
    const baseLinks = linkRows(p);
    // Diff com encerramento (troca de vendedor) e criação (cliente novo); o gatilho aborta o evento
    // do cliente novo, depois do encerramento e da inserção dos vínculos.
    const target = cs[0] as number;
    const old = baseLinks.find((l) => l.c === target && l.g === g1) as LinkRow;
    dist().replaceAssignments(admin(), p, 3, {
      set: [{ customerId: target, productSubgroupId: g1, sellerId: old.s === A ? B : A }],
    });
    const fresh = customer();
    dist().distribute(admin(), p, 4);
    sqlite().exec(
      `create trigger boom before insert on portfolio_link_events when new.customer_id = ${fresh} begin select raise(abort, 'boom'); end`,
    );
    const before = row(p);
    expect(() => links().finalize(admin(), p, before.version)).toThrow();
    expect(counts()).toEqual(base);
    expect(linkRows(p)).toEqual(baseLinks);
    expect(row(p)).toEqual(before);
  });
});

describe('leituras', () => {
  it('listLinks: só ativos, filtros, cursor, total e dados de exibição', () => {
    const { p, g1, g2, A, B, C } = distributed();
    links().finalize(admin(), p, 2);
    const s = links();
    const all = s.listLinks(admin(), p, { limit: 200 });
    expect(all.total).toBe(8);
    expect(all.items[0]?.customer).toMatchObject({ cnpj: '00000000000001', legalName: 'Cliente 1' });
    expect(all.items[0]?.productSubgroup.code).toMatch(/^G[12]$/);
    expect(all.items[0]?.seller.name).toMatch(/^Vendedor /);
    expect(s.listLinks(admin(), p, { productSubgroupId: g1 }).total).toBe(4);
    expect(s.listLinks(admin(), p, { productSubgroupId: g2 }).total).toBe(4);
    expect(s.listLinks(admin(), p, { sellerId: B }).items.every((i) => i.seller.id === B)).toBe(true);
    const bySeller = [A, B, C].map((x) => s.listLinks(admin(), p, { sellerId: x }).total);
    expect(bySeller.reduce((a, b) => a + b, 0)).toBe(8);
    const ids: number[] = [];
    let cursor: string | undefined;
    do {
      const page = s.listLinks(readerOf('SER'), p, { limit: 3, ...(cursor ? { cursor } : {}) });
      ids.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual(linkRows(p).map((l) => l.id));
    expect(codeOf(() => s.listLinks(admin(), p, { cursor: 'xx' }))).toBe('validation_error');
    expect(codeOf(() => s.listLinks(adminOf('XXX'), p))).toBe('not_found');
    // Encerrados saem de listLinks e ficam no histórico.
    createPortfolioService(fx.db).deactivate(admin(), p, 3);
    expect(s.listLinks(admin(), p).total).toBe(0);
    expect(s.listLinkHistory(admin(), p, { limit: 200 }).items).toHaveLength(8);
  });

  it('listLinkEvents: cursor after, limite e escopo de filial', () => {
    const { p } = distributed();
    links().finalize(admin(), p, 2);
    const s = links();
    const first = s.listLinkEvents(admin(), { limit: 5 });
    expect(first.items.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
    expect(first.hasMore).toBe(true);
    expect(first.nextAfter).toBe(5);
    const second = s.listLinkEvents(admin(), { after: first.nextAfter as number });
    expect(second.items.map((e) => e.id)).toEqual([6, 7, 8]);
    expect(second.hasMore).toBe(false);
    expect(second.items[0]).toMatchObject({ kind: 'created', portfolioId: p, branch: { code: 'SER' } });
    expect(s.listLinkEvents(admin(), { after: 8 })).toEqual({ items: [], nextAfter: null, hasMore: false });
    expect(s.listLinkEvents(admin(), { branchId: ser }).items).toHaveLength(8);
    // Filial fora do token: not_found; sem branchId, só as filiais do token.
    const other = seedBranch(fx.db, 'OUT');
    expect(codeOf(() => s.listLinkEvents(admin(), { branchId: other }))).toBe('not_found');
    expect(s.listLinkEvents(adminOf('OUT')).items).toEqual([]);
    expect(s.listLinkEvents(adminOf('SER', 'OUT')).items).toHaveLength(8);
    expect(codeOf(() => s.listLinkEvents(admin(), { limit: 1001 }))).toBe('validation_error');
    expect(codeOf(() => s.listLinkEvents(admin(), { limit: 0 }))).toBe('validation_error');
  });
});
