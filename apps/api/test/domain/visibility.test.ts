import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCustomerService } from '../../src/domain/customers/service.js';
import { createDistributionService } from '../../src/domain/distribution/service.js';
import { createEligibilityService } from '../../src/domain/eligibility/service.js';
import { createLinkService } from '../../src/domain/links/service.js';
import { createPortfolioService } from '../../src/domain/portfolios/service.js';
import { createSellerService } from '../../src/domain/sellers/service.js';
import { neighborhoodKey, searchKey } from '../../src/domain/shared/normalize.js';
import { effectiveProfiles } from '../../src/domain/visibility/profiles.js';
import { createVisibilityService } from '../../src/domain/visibility/service.js';
import {
  ES,
  VITORIA,
  actor,
  adminOf,
  codeOf,
  makeFixture,
  seedBranch,
  type Fixture,
} from '../helpers/seed.js';

const NOW = 1_700_000_000_000;

let fx: Fixture;
let ser: number;
let car: number;
let typeId: number;
let seq = 0;
let legacyCalls: string[];

const sq = () => fx.app.sqlite;
const opts = () => ({ now: () => NOW, onLegacyAccess: (r: string) => legacyCalls.push(r) });
const vis = () => createVisibilityService(fx.db, opts());
const customersSvc = () => createCustomerService(fx.db, opts());
const portfolios = () => createPortfolioService(fx.db, opts());
const sellersSvc = () => createSellerService(fx.db, opts());
const eligibility = () => createEligibilityService(fx.db, opts());
const distribution = () => createDistributionService(fx.db, opts());
const linksSvc = () => createLinkService(fx.db, opts());

/** Ator com os papéis dados, nas filiais dadas (default: só SER). */
const who = (sub: string, roles: string[], branches: string[] = ['SER']) => actor({ sub, roles, branches });

beforeEach(async () => {
  fx = await makeFixture();
  seq = 0;
  legacyCalls = [];
  ser = seedBranch(fx.db, 'SER');
  car = seedBranch(fx.db, 'CAR');
  typeId = sq()
    .prepare(
      `insert into portfolio_types (code, name, name_key, created_at, updated_at, created_by, updated_by)
       values ('T','Tipo','TIPO',?,?,'t','t')`,
    )
    .run(NOW, NOW).lastInsertRowid as number;
});
afterEach(async () => {
  await fx.app.close();
});

function customer(branch: number | null = ser): number {
  seq += 1;
  const name = `Cliente ${seq}`;
  const id = sq()
    .prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
        neighborhood_key, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,'Centro',?,1,?,?,'t','t')`,
    )
    .run(
      String(seq).padStart(14, '0'),
      name,
      searchKey(name),
      ES,
      VITORIA,
      neighborhoodKey('Centro'),
      NOW,
      NOW,
    ).lastInsertRowid as number;
  if (branch !== null) {
    sq()
      .prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,1)')
      .run(id, branch);
  }
  return id;
}
function portfolio(name: string, responsible: string, branch = ser): number {
  return sq()
    .prepare(
      `insert into portfolios (branch_id, name, name_key, responsible_sub, portfolio_type_id, status, active,
        created_at, updated_at, created_by, updated_by) values (?,?,?,?,?,'active',1,?,?,'t','t')`,
    )
    .run(branch, name, searchKey(name), responsible, typeId, NOW, NOW).lastInsertRowid as number;
}
function subgroup(code: string): number {
  return sq()
    .prepare(
      `insert into product_subgroups (code, name, name_key, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,'t','t')`,
    )
    .run(code, `Subgrupo ${code}`, searchKey(code), NOW, NOW).lastInsertRowid as number;
}
function seller(code: string, userSub: string | null, branch = ser): number {
  const id = sq()
    .prepare(
      `insert into sellers (code, name, name_key, user_sub, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,'t','t')`,
    )
    .run(code, `Vendedor ${code}`, searchKey(code), userSub, NOW, NOW).lastInsertRowid as number;
  sq().prepare('insert into seller_branches (seller_id, branch_id, active) values (?,?,1)').run(id, branch);
  return id;
}
function link(p: number, branch: number, c: number, g: number, s: number): number {
  return sq()
    .prepare(
      `insert into portfolio_links (portfolio_id, branch_id, customer_id, product_subgroup_id, seller_id, active,
        valid_from, created_by) values (?,?,?,?,?,1,?,'t')`,
    )
    .run(p, branch, c, g, s, NOW).lastInsertRowid as number;
}
const pair = (p: number, s: number, g: number) =>
  sq()
    .prepare('insert into portfolio_sellers (portfolio_id, seller_id, product_subgroup_id) values (?,?,?)')
    .run(p, s, g);

interface World {
  c: number[]; // c[1..8]
  g1: number;
  g2: number;
  p1: number;
  p2: number;
  p3: number;
  pc: number;
  s1: number;
  s2: number;
  s3: number;
  link: Record<string, number>;
}

/**
 * Mundo de referência (token SER salvo indicação):
 *  P1 (resp gest1): c1/g1/s1, c2/g1/s1, c2/g2/s2     P2 (resp gest2): c3/g1/s2, c4/g2/s1
 *  P3 (resp sub-s1): c5/g1/s2                       PC (CAR, resp gest1): c7/g1/s1
 *  c6 e c8 sem carteira; c7 só na CAR. s3 (V3) sem login.
 */
function world(): World {
  const c = [0, ...Array.from({ length: 6 }, () => customer(ser)), customer(car), customer(ser)];
  const g1 = subgroup('G1');
  const g2 = subgroup('G2');
  const s1 = seller('V1', 'sub-s1');
  const s2 = seller('V2', 'sub-s2');
  const s3 = seller('V3', null);
  const p1 = portfolio('P1', 'gest1');
  const p2 = portfolio('P2', 'gest2');
  const p3 = portfolio('P3', 'sub-s1');
  const pc = portfolio('PC', 'gest1', car);
  pair(p1, s1, g1);
  pair(p1, s2, g2);
  pair(p2, s2, g1);
  pair(p2, s1, g2);
  const l = {
    c1: link(p1, ser, c[1] as number, g1, s1),
    c2a: link(p1, ser, c[2] as number, g1, s1),
    c2b: link(p1, ser, c[2] as number, g2, s2),
    c3: link(p2, ser, c[3] as number, g1, s2),
    c4: link(p2, ser, c[4] as number, g2, s1),
    c5: link(p3, ser, c[5] as number, g1, s2),
    c7: link(pc, car, c[7] as number, g1, s1),
  };
  return { c, g1, g2, p1, p2, p3, pc, s1, s2, s3, link: l };
}

const ids = (w: World, ...n: number[]) => n.map((i) => w.c[i] as number).sort((a, b) => a - b);
const mine = (a: ReturnType<typeof who>) =>
  vis()
    .listMyCustomers(a, { limit: 200 })
    .items.map((i) => i.id);

describe('visibilidade: quem vê o quê', () => {
  it('perfis efetivos vêm das constantes; sem perfil conhecido o modo é legacy', () => {
    expect(effectiveProfiles(who('x', ['vendedor', 'gestor', 'zzz']))).toEqual(['gestor', 'vendedor']);
    expect(vis().summary(who('x', ['zzz'])).mode).toBe('legacy');
    expect(vis().summary(who('x', ['gestor'])).mode).toBe('profiles');
  });

  it('vendedor vê só os clientes dos seus vínculos ativos, nas filiais do token', () => {
    const w = world();
    expect(mine(who('sub-s1', ['vendedor']))).toEqual(ids(w, 1, 2, 4));
    expect(mine(who('sub-s2', ['vendedor']))).toEqual(ids(w, 2, 3, 5));
    // A CAR só entra com a filial no token.
    expect(mine(who('sub-s1', ['vendedor'], ['SER', 'CAR']))).toEqual(ids(w, 1, 2, 4, 7));
    expect(mine(who('sub-s1', ['vendedor'], ['CAR']))).toEqual(ids(w, 7));
    expect(mine(who('sub-s1', ['vendedor'], []))).toEqual([]);
  });

  it('vendedor sem userSub (ou com sub que não bate) não vê nada como vendedor', () => {
    world();
    expect(mine(who('sub-s3', ['vendedor']))).toEqual([]);
    expect(mine(who('ninguem', ['vendedor']))).toEqual([]);
    const s = vis().summary(who('sub-s3', ['vendedor']));
    expect(s).toMatchObject({ seller: null, visibleCustomers: 0, byProfile: { vendedor: 0 } });
    // Mesmo o vendedor sem login: o sub vazio não casa com user_sub nulo.
    expect(mine(who('', ['vendedor']))).toEqual([]);
  });

  it('gestor vê os clientes das carteiras em que é responsável', () => {
    const w = world();
    expect(mine(who('gest1', ['gestor']))).toEqual(ids(w, 1, 2));
    expect(mine(who('gest2', ['gestor']))).toEqual(ids(w, 3, 4));
    expect(mine(who('gest1', ['gestor'], ['SER', 'CAR']))).toEqual(ids(w, 1, 2, 7));
    expect(mine(who('outro', ['gestor']))).toEqual([]);
  });

  it('admin e supervisão veem os clientes ativos das filiais do token', () => {
    const w = world();
    const all = ids(w, 1, 2, 3, 4, 5, 6, 8);
    expect(mine(who('a', ['admin']))).toEqual(all);
    expect(mine(who('a', ['supervisao']))).toEqual(all);
    expect(mine(who('a', ['admin'], ['SER', 'CAR']))).toEqual(ids(w, 1, 2, 3, 4, 5, 6, 7, 8));
    expect(mine(who('a', ['admin'], ['CAR']))).toEqual(ids(w, 7));
    // Cliente sem nenhuma filial e vínculo inativo na filial não entram.
    customer(null);
    sq().prepare('update customer_branches set active = 0 where customer_id = ?').run(w.c[6]);
    expect(mine(who('a', ['admin']))).toEqual(ids(w, 1, 2, 3, 4, 5, 8));
  });

  it('perfis somam (sem repetir cliente) e o resumo conta por perfil', () => {
    const w = world();
    // sub-s1: vendedor (c1, c2, c4) + gestor da P3 (c5)
    const a = who('sub-s1', ['vendedor', 'gestor']);
    expect(mine(a)).toEqual(ids(w, 1, 2, 4, 5));
    expect(vis().summary(a)).toEqual({
      profiles: ['gestor', 'vendedor'],
      mode: 'profiles',
      seller: { id: w.s1, code: 'V1' },
      visibleCustomers: 4,
      byProfile: { gestor: 1, vendedor: 3 },
    });
    // admin + vendedor: a união é a filial inteira
    const b = who('sub-s2', ['admin', 'vendedor']);
    const s = vis().summary(b);
    expect(s.visibleCustomers).toBe(7);
    expect(s.byProfile).toEqual({ admin: 7, vendedor: 3 });
    expect(vis().summary(who('s', ['admin', 'supervisao'])).byProfile).toEqual({ admin: 7, supervisao: 7 });
  });

  it('via explica por subgrupo e carteira; filtros q, subgrupo, paginação e total', () => {
    const w = world();
    const a = who('sub-s1', ['vendedor']);
    const page = vis().listMyCustomers(a, { limit: 200 });
    expect(page.total).toBe(3);
    const c2 = page.items.find((i) => i.id === w.c[2]);
    expect(c2).toMatchObject({
      cnpj: '00000000000002',
      legalName: 'Cliente 2',
      via: [{ productSubgroupId: w.g1, portfolioId: w.p1, profile: 'vendedor' }],
    });
    expect(Object.keys(c2 ?? {}).sort()).toEqual(
      ['cnpj', 'id', 'legalName', 'municipalityCode', 'neighborhood', 'stateCode', 'tradeName', 'via'].sort(),
    );
    // por subgrupo: g2 de s1 é só o c4 (via P2)
    const g2 = vis().listMyCustomers(a, { productSubgroupId: w.g2 });
    expect(g2.items.map((i) => i.id)).toEqual(ids(w, 4));
    expect(g2.items[0]?.via).toEqual([{ productSubgroupId: w.g2, portfolioId: w.p2, profile: 'vendedor' }]);
    // busca
    expect(
      vis()
        .listMyCustomers(a, { q: 'cliente 4' })
        .items.map((i) => i.id),
    ).toEqual(ids(w, 4));
    expect(vis().listMyCustomers(a, { q: 'cliente 3' }).total).toBe(0); // existe, mas não é visível
    // paginação por cursor
    const p1 = vis().listMyCustomers(a, { limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = vis().listMyCustomers(a, { limit: 2, cursor: p1.nextCursor as string });
    expect([...p1.items, ...p2.items].map((i) => i.id)).toEqual(ids(w, 1, 2, 4));
    expect(p2.nextCursor).toBeNull();
    expect(p2.total).toBe(3);
    // perfis que somam geram uma entrada por perfil
    const both = vis()
      .listMyCustomers(who('sub-s1', ['vendedor', 'gestor']))
      .items.find((i) => i.id === w.c[5]);
    expect(both?.via).toEqual([{ productSubgroupId: w.g1, portfolioId: w.p3, profile: 'gestor' }]);
    // admin sem vínculo: visível, via vazio
    const adm = vis().listMyCustomers(who('a', ['admin']), { q: 'cliente 6' });
    expect(adm.items[0]?.via).toEqual([]);
    expect(codeOf(() => vis().listMyCustomers(a, { limit: 0 }))).toBe('validation_error');
  });

  it('vínculo encerrado (E7) some da visibilidade na hora', () => {
    const w = world();
    const a = who('sub-s1', ['vendedor']);
    expect(mine(a)).toContain(w.c[1]);
    sq()
      .prepare('update portfolio_links set active = 0, valid_to = ?, ended_by = ? where id = ?')
      .run(NOW, 't', w.link.c1);
    expect(mine(a)).toEqual(ids(w, 2, 4));
    expect(vis().check(a, [w.c[1] as number, w.c[2] as number]).visible).toEqual(ids(w, 2));
    // E7 de verdade: inativar o vendedor encerra os vínculos dele
    sellersSvc().deactivateGlobal(adminOf('SER'), w.s1, 1);
    expect(mine(a)).toEqual([]);
    // E7 de verdade: cliente inativo perde o vínculo e sai da visibilidade do gestor
    // (a inativação do s1 acima também encerrou o c4 da P2, que era dele)
    const g = who('gest2', ['gestor']);
    expect(mine(g)).toEqual(ids(w, 3));
    customersSvc().deactivateGlobal(adminOf('SER'), w.c[3] as number, 1);
    expect(mine(g)).toEqual([]);
  });

  it('cliente com vários vínculos do mesmo perfil conta e volta uma só vez', () => {
    const w = world();
    // s1 passa a ter c1 também no subgrupo g2: 2 vínculos no mesmo cliente
    link(w.p1, ser, w.c[1] as number, w.g2, w.s1);
    const a = who('sub-s1', ['vendedor']);
    expect(vis().check(a, [w.c[1] as number])).toEqual({ visible: ids(w, 1) });
    expect(vis().summary(a)).toMatchObject({ visibleCustomers: 3, byProfile: { vendedor: 3 } });
    expect(vis().listMyCustomers(a).total).toBe(3);
    expect(
      vis()
        .listMyCustomers(a)
        .items.find((i) => i.id === w.c[1])?.via,
    ).toHaveLength(2);
  });

  it('check: devolve só os visíveis e não distingue inexistente de invisível', () => {
    const w = world();
    const a = who('sub-s1', ['vendedor']);
    const asked = [w.c[4], w.c[1], w.c[3], w.c[7], 999_999, w.c[8]] as number[];
    expect(vis().check(a, asked)).toEqual({ visible: ids(w, 1, 4) });
    // inexistente e invisível produzem exatamente a mesma resposta
    expect(vis().check(a, [w.c[3] as number])).toEqual(vis().check(a, [999_999]));
    expect(vis().check(a, [])).toEqual({ visible: [] });
    expect(vis().check(who('a', ['admin']), asked)).toEqual({ visible: ids(w, 1, 3, 4, 8) });
    expect(vis().check(who('a', ['admin'], []), asked)).toEqual({ visible: [] });
    // filial fora do token nunca
    expect(vis().check(who('sub-s1', ['vendedor']), [w.c[7] as number]).visible).toEqual([]);
  });

  it('check: ids inválidos, repetidos ou em excesso são 400', () => {
    world();
    const a = who('sub-s1', ['vendedor']);
    const bad = (v: unknown) => codeOf(() => vis().check(a, v as number[]));
    expect(bad([0])).toBe('validation_error');
    expect(bad([-1])).toBe('validation_error');
    expect(bad([1.5])).toBe('validation_error');
    expect(bad(['1'])).toBe('validation_error');
    expect(bad([1, 1])).toBe('validation_error');
    expect(bad(Array.from({ length: 1001 }, (_, i) => i + 1))).toBe('validation_error');
    expect(bad(Array.from({ length: 1000 }, (_, i) => i + 1))).toBe('no_error');
  });
});

describe('legacy (nenhum perfil conhecido)', () => {
  it('lê como antes e avisa pelo gancho, sem dado pessoal', () => {
    const w = world();
    const a = who('quem-quer', ['outro-papel']);
    expect(mine(a)).toEqual(ids(w, 1, 2, 3, 4, 5, 6, 8));
    expect(legacyCalls).toEqual(['visibility']);
    expect(vis().listMyCustomers(a).items[0]?.via).toBeDefined();
    // restrições (a) e (b) não se aplicam
    legacyCalls.length = 0;
    expect(customersSvc().list(a, { limit: 200 }).items).toHaveLength(7);
    expect(customersSvc().get(a, w.c[3] as number).id).toBe(w.c[3]);
    expect(portfolios().list(a).items).toHaveLength(3);
    expect(portfolios().get(a, w.p3).id).toBe(w.p3);
    expect(legacyCalls.length).toBeGreaterThan(0);
    expect(new Set(legacyCalls)).toEqual(new Set(['customers', 'portfolios']));
    expect(legacyCalls.join()).not.toMatch(/quem-quer|outro-papel|SER/);
    expect(vis().summary(a)).toMatchObject({
      mode: 'legacy',
      profiles: [],
      visibleCustomers: 7,
      byProfile: { legacy: 7 },
    });
  });

  it('quem tem perfil conhecido nunca dispara o aviso', () => {
    world();
    vis().summary(who('a', ['admin']));
    customersSvc().list(who('a', ['admin']));
    mine(who('sub-s1', ['vendedor']));
    expect(legacyCalls).toEqual([]);
  });
});

describe('restrições nas leituras existentes', () => {
  it('(a) clientes: vendedor e gestor só leem os visíveis; admin, supervisão e legacy leem a filial', () => {
    const w = world();
    const v = who('sub-s1', ['vendedor']);
    expect(
      customersSvc()
        .list(v, { limit: 200 })
        .items.map((i) => i.id)
        .sort((x, y) => x - y),
    ).toEqual(ids(w, 1, 2, 4));
    expect(customersSvc().get(v, w.c[1] as number).id).toBe(w.c[1]);
    expect(codeOf(() => customersSvc().get(v, w.c[3] as number))).toBe('not_found');
    expect(codeOf(() => customersSvc().get(v, 999_999))).toBe('not_found'); // igual a invisível
    expect(customersSvc().list(v, { q: 'cliente 3' }).items).toEqual([]);
    const g = who('gest2', ['gestor']);
    expect(
      customersSvc()
        .list(g, { limit: 200 })
        .items.map((i) => i.id),
    ).toEqual(ids(w, 3, 4));
    expect(codeOf(() => customersSvc().get(g, w.c[1] as number))).toBe('not_found');
    // vendedor sem login não lê nada
    expect(customersSvc().list(who('sub-s3', ['vendedor']), { limit: 200 }).items).toEqual([]);
    for (const roles of [['admin'], ['supervisao']]) {
      expect(customersSvc().list(who('a', roles), { limit: 200 }).items).toHaveLength(7);
      expect(customersSvc().get(who('a', roles), w.c[3] as number).id).toBe(w.c[3]);
    }
  });

  it('(b) carteiras: gestor vê as suas; vendedor vê as em que atua; demais como antes', () => {
    const w = world();
    const list = (a: ReturnType<typeof who>) =>
      portfolios()
        .list(a)
        .items.map((i) => i.id);
    expect(list(who('gest1', ['gestor']))).toEqual([w.p1]);
    expect(list(who('gest1', ['gestor'], ['SER', 'CAR']))).toEqual([w.p1, w.pc]);
    // s1 está em portfolio_sellers de P1 e P2; P3 só tem s2
    expect(list(who('sub-s1', ['vendedor']))).toEqual([w.p1, w.p2, w.p3]); // P3: responsável
    expect(list(who('sub-s2', ['vendedor']))).toEqual([w.p1, w.p2, w.p3]);
    expect(list(who('sub-s3', ['vendedor']))).toEqual([]);
    expect(list(who('a', ['admin']))).toEqual([w.p1, w.p2, w.p3]);
    expect(list(who('a', ['supervisao']))).toEqual([w.p1, w.p2, w.p3]);
    expect(portfolios().get(who('gest1', ['gestor']), w.p1).id).toBe(w.p1);
    expect(codeOf(() => portfolios().get(who('gest1', ['gestor']), w.p2))).toBe('not_found');
    expect(codeOf(() => portfolios().get(who('sub-s3', ['vendedor']), w.p1))).toBe('not_found');
    expect(portfolios().get(who('a', ['supervisao']), w.p2).id).toBe(w.p2);
    // vendedor com vínculo ativo, mas fora de portfolio_sellers (retirado depois), ainda vê a carteira
    sq().prepare('delete from portfolio_sellers where portfolio_id = ? and seller_id = ?').run(w.p2, w.s1);
    expect(portfolios().get(who('sub-s1', ['vendedor']), w.p2).id).toBe(w.p2);
    // encerrado o vínculo e sem pares, a carteira some para ele
    sq().prepare('update portfolio_links set active = 0 where id = ?').run(w.link.c4);
    expect(codeOf(() => portfolios().get(who('sub-s1', ['vendedor']), w.p2))).toBe('not_found');
  });

  it('(c) prévia, ajustes, atribuições e vínculos: admin, supervisão, legacy ou responsável', () => {
    const w = world();
    const reads = (a: ReturnType<typeof who>, p: number) => ({
      preview: () => eligibility().preview(a, p),
      overrides: () => eligibility().getOverrides(a, p),
      assignments: () => distribution().listAssignments(a, p),
      summary: () => distribution().summary(a, p),
      links: () => linksSvc().listLinks(a, p),
      history: () => linksSvc().listLinkHistory(a, p),
    });
    const allowed = (a: ReturnType<typeof who>, p: number) =>
      Object.values(reads(a, p)).map((fn) => codeOf(fn));
    const ok = Array(6).fill('no_error');
    const hidden = Array(6).fill('not_found');
    for (const a of [
      who('a', ['admin']),
      who('a', ['supervisao']),
      who('a', ['x-legacy']),
      who('gest1', ['gestor']), // responsável
      who('gest1', ['vendedor']), // responsável, qualquer perfil
    ]) {
      expect(allowed(a, w.p1)).toEqual(ok);
    }
    for (const a of [
      who('gest2', ['gestor']), // gestor de outra carteira
      who('sub-s1', ['vendedor']), // atua na carteira, mas não é responsável
      who('sub-s3', ['vendedor']),
    ]) {
      expect(allowed(a, w.p1)).toEqual(hidden);
    }
    // A outbox da filial exige leitura ampla.
    expect(codeOf(() => linksSvc().listLinkEvents(who('sub-s1', ['vendedor'])))).toBe('forbidden');
    expect(codeOf(() => linksSvc().listLinkEvents(who('gest1', ['gestor'])))).toBe('forbidden');
    for (const roles of [['admin'], ['supervisao'], ['x-legacy']]) {
      expect(codeOf(() => linksSvc().listLinkEvents(who('a', roles)))).toBe('no_error');
    }
  });
});

describe('supervisão nunca escreve', () => {
  it('toda escrita é 403, inclusive como responsável da carteira', () => {
    const w = world();
    const sup = who('a', ['supervisao']);
    // responsável por P1 e supervisão: continua sem escrever
    const supResp = who('gest1', ['supervisao', 'gestor']);
    expect(portfolios().get(supResp, w.p1).id).toBe(w.p1);
    const cnpj = '11222333000181';
    const writes: Array<[string, () => unknown]> = [];
    for (const [tag, a] of [
      ['sup', sup],
      ['sup-resp', supResp],
    ] as const) {
      writes.push(
        [
          `${tag} customer.create`,
          () =>
            customersSvc().create(a, {
              cnpj,
              legalName: 'X',
              municipalityCode: VITORIA,
              neighborhood: 'C',
              branchIds: [ser],
            }),
        ],
        [`${tag} customer.update`, () => customersSvc().update(a, w.c[1] as number, 1, { legalName: 'Y' })],
        [`${tag} customer.deactivate`, () => customersSvc().deactivate(a, w.c[1] as number, 1)],
        [`${tag} customer.deactivateGlobal`, () => customersSvc().deactivateGlobal(a, w.c[1] as number, 1)],
        [`${tag} customer.link`, () => customersSvc().linkCustomerToBranchByCnpj(a, cnpj, ser)],
        [`${tag} seller.create`, () => sellersSvc().create(a, { code: 'Z', name: 'Z', branchIds: [ser] })],
        [`${tag} seller.update`, () => sellersSvc().update(a, w.s1, 1, { userSub: 'novo' })],
        [`${tag} seller.deactivate`, () => sellersSvc().deactivate(a, w.s1, 1)],
        [
          `${tag} portfolio.create`,
          () =>
            portfolios().create(a, {
              name: 'N',
              branchId: ser,
              portfolioTypeId: typeId,
              responsibleSub: 'r',
            }),
        ],
        [`${tag} portfolio.update`, () => portfolios().update(a, w.p1, 1, { name: 'Novo' })],
        [
          `${tag} portfolio.replaceFilters`,
          () =>
            portfolios().replaceFilters(a, w.p1, 1, {
              regions: [],
              retailNetworkIds: [],
              economicGroupIds: [],
            }),
        ],
        [
          `${tag} portfolio.replaceSellers`,
          () => portfolios().replaceSellers(a, w.p1, 1, { assignments: [] }),
        ],
        [`${tag} portfolio.deactivate`, () => portfolios().deactivate(a, w.p1, 1)],
        [
          `${tag} eligibility.replaceOverrides`,
          () => eligibility().replaceOverrides(a, w.p1, 1, { include: [], exclude: [] }),
        ],
        [`${tag} distribution.distribute`, () => distribution().distribute(a, w.p1, 1)],
        [
          `${tag} distribution.replaceAssignments`,
          () => distribution().replaceAssignments(a, w.p1, 1, { set: [], clear: [] }),
        ],
        [`${tag} links.finalize`, () => linksSvc().finalize(a, w.p1, 1)],
      );
    }
    for (const [label, fn] of writes) expect([label, codeOf(fn)]).toEqual([label, 'forbidden']);
    // Nada mudou no banco.
    expect(sq().prepare('select count(*) as n from portfolio_links').get()).toEqual({ n: 7 });
    expect(sq().prepare('select version from portfolios where id = ?').get(w.p1)).toEqual({ version: 1 });
  });
});

describe('sellers.userSub', () => {
  const admin = () => adminOf('SER');

  it('admin grava (trim), é único, vazio vira null e não-admin não recebe o campo', () => {
    const svc = sellersSvc();
    const s = svc.create(admin(), { code: 'A1', name: 'Ana', branchIds: [ser], userSub: '  sub-ana  ' });
    expect(s.userSub).toBe('sub-ana');
    expect(svc.get(admin(), s.id).userSub).toBe('sub-ana');
    // sem a ligação o admin vê null; dois cadastros sem ligação convivem
    const b = svc.create(admin(), { code: 'B1', name: 'Bia', branchIds: [ser] });
    const c = svc.create(admin(), { code: 'C1', name: 'Cris', branchIds: [ser], userSub: '   ' });
    expect(b.userSub).toBeNull();
    expect(c.userSub).toBeNull();
    // unicidade, na criação e no PATCH
    expect(
      codeOf(() => svc.create(admin(), { code: 'D1', name: 'Duda', branchIds: [ser], userSub: 'sub-ana' })),
    ).toBe('conflict');
    expect(codeOf(() => svc.update(admin(), b.id, 1, { userSub: ' sub-ana ' }))).toBe('conflict');
    expect(svc.update(admin(), b.id, 1, { userSub: 'sub-bia' }).userSub).toBe('sub-bia');
    // reenviar o próprio sub não conflita; null/vazio limpa
    expect(svc.update(admin(), b.id, 2, { userSub: 'sub-bia' }).userSub).toBe('sub-bia');
    expect(svc.update(admin(), b.id, 3, { userSub: '' }).userSub).toBeNull();
    expect(svc.update(admin(), s.id, 1, { userSub: null }).userSub).toBeNull();
    // o sub liberado pode ser reusado
    expect(svc.update(admin(), b.id, 4, { userSub: 'sub-ana' }).userSub).toBe('sub-ana');
    // outros campos preservam o sub
    expect(svc.update(admin(), b.id, 5, { name: 'Bia 2' }).userSub).toBe('sub-ana');

    // minimização: nenhum perfil não-admin recebe o campo (nem null), em get e list
    for (const roles of [['vendedor'], ['gestor'], ['supervisao'], ['x']]) {
      const a = who('u', roles);
      const got = svc.get(a, b.id);
      expect('userSub' in got).toBe(false);
      expect(svc.list(a, { limit: 200 }).items.every((i) => !('userSub' in i))).toBe(true);
    }
    // e não-admin não grava
    expect(codeOf(() => svc.update(who('u', ['vendedor']), b.id, 6, { userSub: 'x' }))).toBe('forbidden');
    expect(
      codeOf(() =>
        svc.create(who('u', ['supervisao']), { code: 'E1', name: 'E', branchIds: [ser], userSub: 'x' }),
      ),
    ).toBe('forbidden');
  });

  it('o sub é dado do cadastro inteiro: exige todas as filiais do vendedor no token', () => {
    const svc = sellersSvc();
    const s = svc.create(adminOf('SER', 'CAR'), { code: 'M1', name: 'Multi', branchIds: [ser, car] });
    expect(codeOf(() => svc.update(admin(), s.id, 1, { userSub: 'sub-m' }))).toBe('forbidden');
    expect(svc.update(adminOf('SER', 'CAR'), s.id, 1, { userSub: 'sub-m' }).userSub).toBe('sub-m');
  });

  it('o login ligado dá a visibilidade imediatamente', () => {
    const w = world();
    const a = who('sub-novo', ['vendedor']);
    expect(mine(a)).toEqual([]);
    sellersSvc().update(adminOf('SER'), w.s3, 1, { userSub: 'sub-novo' });
    link(w.p1, ser, w.c[6] as number, w.g1, w.s3);
    expect(mine(a)).toEqual(ids(w, 6));
  });
});
