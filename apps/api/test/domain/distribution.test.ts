import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDistributionService } from '../../src/domain/distribution/service.js';
import { balancedStrategy } from '../../src/domain/distribution/strategies/balanced.js';
import { createPortfolioService } from '../../src/domain/portfolios/service.js';
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

let fx: Fixture;
let ser: number;
let typeId: number;
let seq = 0;

const sqlite = () => fx.app.sqlite;
const admin = () => adminOf('SER');
const resp = () => actor({ sub: 'resp', roles: ['vendedor'], branches: ['SER'] });
const svc = () => createDistributionService(fx.db, { now: () => NOW });
const version = (p: number) =>
  (sqlite().prepare('select version from portfolios where id = ?').get(p) as { version: number }).version;

async function setup(): Promise<void> {
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

interface Row {
  c: number;
  g: number;
  s: number;
}
const stored = (p: number): Row[] =>
  sqlite()
    .prepare(
      'select customer_id as c, product_subgroup_id as g, seller_id as s from portfolio_assignments where portfolio_id = ? order by 1, 2',
    )
    .all(p) as Row[];

/** Carteira P (UF ES) com 2 subgrupos: A atende g1 e g2; B atende g1; C atende g2. 4 clientes em Vitória. */
function basic() {
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
  return { p, g1, g2, A, B, C, cs };
}

describe('grade e status', () => {
  it('a grade é membros efetivos x subgrupos da carteira; tudo começa unassigned', () => {
    const { p, g1, g2, cs } = basic();
    customer({ active: false }); // inativo: fora da carteira
    const page = svc().listAssignments(admin(), p, { limit: 200 });
    expect(page.total).toBe(8);
    expect(page.items.map((i) => [i.customer.id, i.productSubgroup.id])).toEqual(
      cs.flatMap((c) => [
        [c, g1],
        [c, g2],
      ]),
    );
    expect(page.items.every((i) => i.status === 'unassigned' && i.seller === null)).toBe(true);
    expect(page.items[0]?.customer).toEqual({ id: cs[0], cnpj: '00000000000001', legalName: 'Cliente 1' });
    expect(page.items[0]?.productSubgroup).toEqual({ id: g1, code: 'G1', name: 'Subgrupo G1' });
  });

  it('um vendedor por cliente por subgrupo; vendedores diferentes em subgrupos diferentes', () => {
    const { p, g1, g2, A, B, C, cs } = basic();
    const c = cs[0] as number;
    svc().replaceAssignments(admin(), p, 1, {
      set: [
        { customerId: c, productSubgroupId: g1, sellerId: A },
        { customerId: c, productSubgroupId: g2, sellerId: C },
      ],
    });
    // Reatribuir a mesma célula troca o vendedor: continua uma linha por (cliente, subgrupo).
    svc().replaceAssignments(admin(), p, 2, { set: [{ customerId: c, productSubgroupId: g1, sellerId: B }] });
    expect(stored(p)).toEqual([
      { c, g: g1, s: B },
      { c, g: g2, s: C },
    ]);
    // O banco recusa a segunda linha da mesma célula.
    expect(() =>
      sqlite().prepare("insert into portfolio_assignments values (?,?,?,?,1,'t',1,'t')").run(p, c, g1, A),
    ).toThrow(/UNIQUE|PRIMARY/);
  });

  it('página por (cliente, subgrupo), cursor e filtros', () => {
    const { p, g1, A, B, cs } = basic();
    svc().replaceAssignments(admin(), p, 1, {
      set: [
        { customerId: cs[0] as number, productSubgroupId: g1, sellerId: A },
        { customerId: cs[1] as number, productSubgroupId: g1, sellerId: B },
      ],
    });
    const s = svc();
    const first = s.listAssignments(admin(), p, { limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.total).toBe(8);
    const second = s.listAssignments(admin(), p, {
      limit: 3,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    const third = s.listAssignments(admin(), p, {
      limit: 3,
      ...(second.nextCursor ? { cursor: second.nextCursor } : {}),
    });
    expect(third.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items, ...third.items].map(
      (i) => `${i.customer.id}.${i.productSubgroup.id}`,
    );
    expect(new Set(ids).size).toBe(8);
    expect(s.listAssignments(admin(), p, { status: 'assigned' }).total).toBe(2);
    expect(s.listAssignments(admin(), p, { status: 'unassigned' }).total).toBe(6);
    expect(s.listAssignments(admin(), p, { sellerId: B }).items.map((i) => i.customer.id)).toEqual([cs[1]]);
    expect(s.listAssignments(admin(), p, { productSubgroupId: g1 }).total).toBe(4);
    expect(codeOf(() => s.listAssignments(admin(), p, { cursor: 'xx' }))).toBe('validation_error');
    expect(codeOf(() => s.listAssignments(admin(), p, { status: 'x' as 'stale' }))).toBe('validation_error');
  });
});

describe('edição manual', () => {
  it('set exige membro efetivo, subgrupo da carteira, par na carteira e vendedor válido (sem eco)', () => {
    const { p, g1, g2, A, B, C, cs } = basic();
    const other = subgroup('G3');
    const inactive = seller('INA', { active: false });
    const unlinked = seller('UNL', { linked: 'none' });
    const linkOff = seller('OFF', { linked: 'inactive' });
    for (const x of [inactive, unlinked, linkOff]) pair(p, x, g1);
    // Cliente que perde a disputa (carteira rival de Serra, posto maior) e cliente bloqueado (empate).
    const lost = customer({ municipality: SERRA });
    const rival = portfolio('Rival');
    byCity(rival, SERRA);
    const set = (customerId: number, productSubgroupId: number, sellerId: number) =>
      codeOf(() =>
        svc().replaceAssignments(admin(), p, version(p), {
          set: [{ customerId, productSubgroupId, sellerId }],
        }),
      );

    expect(set(lost, g1, A)).toBe('validation_error'); // lost
    expect(set(cs[0] as number, other, A)).toBe('validation_error'); // subgrupo fora da carteira
    expect(set(cs[0] as number, g1, C)).toBe('validation_error'); // C só atende g2
    expect(set(cs[0] as number, g2, B)).toBe('validation_error'); // B só atende g1
    expect(set(cs[0] as number, g1, inactive)).toBe('validation_error');
    expect(set(cs[0] as number, g1, unlinked)).toBe('validation_error');
    expect(set(cs[0] as number, g1, linkOff)).toBe('validation_error');
    expect(set(999_999, g1, A)).toBe('validation_error');
    expect(stored(p)).toEqual([]);
    expect(set(cs[0] as number, g1, A)).toBe('no_error');

    // Cliente bloqueado por empate: outra carteira com o mesmo filtro (todos viram `blocked`).
    const twin = portfolio('Twin');
    byState(twin);
    expect(set(cs[1] as number, g1, A)).toBe('validation_error');
    let message = '';
    try {
      svc().replaceAssignments(admin(), p, version(p), {
        set: [{ customerId: 424242, productSubgroupId: 777, sellerId: 888 }],
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toMatch(/424242|777|888/);
  });

  it('clear remove (inclusive stale) e é idempotente; versão sobe uma vez por chamada', () => {
    const { p, g1, A, cs } = basic();
    const c = cs[0] as number;
    const out = svc().replaceAssignments(admin(), p, 1, {
      set: [{ customerId: c, productSubgroupId: g1, sellerId: A }],
    });
    expect(out.version).toBe(2);
    const cleared = svc().replaceAssignments(admin(), p, 2, {
      clear: [{ customerId: c, productSubgroupId: g1 }],
    });
    expect(cleared.version).toBe(3);
    expect(stored(p)).toEqual([]);
    expect(
      svc().replaceAssignments(admin(), p, 3, { clear: [{ customerId: c, productSubgroupId: g1 }] }).version,
    ).toBe(4);
  });

  it('célula repetida, em set e clear, vazio e acima de 5.000 itens são validation_error', () => {
    const { p, g1, A, cs } = basic();
    const c = cs[0] as number;
    const item = { customerId: c, productSubgroupId: g1, sellerId: A };
    const run = (input: Parameters<ReturnType<typeof svc>['replaceAssignments']>[3]) =>
      codeOf(() => svc().replaceAssignments(admin(), p, 1, input));
    expect(run({ set: [item, item] })).toBe('validation_error');
    expect(run({ clear: [item, item] })).toBe('validation_error');
    expect(run({ set: [item], clear: [{ customerId: c, productSubgroupId: g1 }] })).toBe('validation_error');
    expect(run({})).toBe('validation_error');
    expect(run({ set: [{ ...item, extra: 1 } as typeof item] })).toBe('validation_error');
    const many = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ customerId: from + i, productSubgroupId: g1 }));
    expect(run({ set: many(3000, 1) as never, clear: many(2001, 10_000) })).toBe('validation_error');
    expect(run({ clear: many(5001, 1) })).toBe('validation_error');
    expect(stored(p)).toEqual([]);
    expect(version(p)).toBe(1);
  });
});

describe('stale', () => {
  it('cliente que perde a disputa, par removido, vendedor inativado ou sem vínculo ficam stale', () => {
    const { p, g1, g2, A, B, C, cs } = basic();
    const near = customer({ municipality: SERRA });
    const all = [...cs, near];
    svc().replaceAssignments(admin(), p, 1, {
      set: all.flatMap((c) => [
        { customerId: c, productSubgroupId: g1, sellerId: A },
        { customerId: c, productSubgroupId: g2, sellerId: C },
      ]),
    });
    const s = svc();
    const statusOf = () =>
      Object.fromEntries(
        s
          .listAssignments(admin(), p, { limit: 200 })
          .items.map((i) => [`${i.customer.id}.${i.productSubgroup.id}`, i.status]),
      );
    expect(s.summary(admin(), p).totals).toEqual({
      members: 5,
      cells: 10,
      assigned: 10,
      unassigned: 0,
      stale: 0,
    });

    // 1) Rival de Serra tira `near`: as duas células dele ficam stale (e continuam visíveis).
    const rival = portfolio('Rival');
    byCity(rival, SERRA);
    let st = statusOf();
    expect(st[`${near}.${g1}`]).toBe('stale');
    expect(st[`${near}.${g2}`]).toBe('stale');
    expect(s.listAssignments(admin(), p, { status: 'stale' }).items[0]?.seller?.id).toBe(A);
    expect(s.summary(admin(), p).totals).toEqual({
      members: 4,
      cells: 8,
      assigned: 8,
      unassigned: 0,
      stale: 2,
    });

    // 2) O par (C, g2) sai da carteira: as 4 células de C ficam stale.
    sqlite().prepare('delete from portfolio_sellers where portfolio_id = ? and seller_id = ?').run(p, C);
    st = statusOf();
    expect(cs.map((c) => st[`${c}.${g2}`])).toEqual(['stale', 'stale', 'stale', 'stale']);
    // 3) O subgrupo g2 sai da carteira de vez (A também deixa de atendê-lo): as células saem da grade,
    // mas seguem stale.
    sqlite()
      .prepare('delete from portfolio_sellers where portfolio_id = ? and product_subgroup_id = ?')
      .run(p, g2);
    expect(s.listAssignments(admin(), p, { productSubgroupId: g2, status: 'stale' }).total).toBe(5);
    expect(s.summary(admin(), p).subgroups.map((x) => x.productSubgroup.id)).toEqual([g1]);

    // 4) Vendedor inativado e vínculo desativado.
    sqlite().prepare('update sellers set active = 0 where id = ?').run(A);
    expect(s.listAssignments(admin(), p, { productSubgroupId: g1, status: 'stale' }).total).toBe(5);
    sqlite().prepare('update sellers set active = 1 where id = ?').run(A);
    expect(s.listAssignments(admin(), p, { productSubgroupId: g1, status: 'assigned' }).total).toBe(4);
    sqlite().prepare('update seller_branches set active = 0 where seller_id = ?').run(A);
    expect(s.listAssignments(admin(), p, { productSubgroupId: g1, status: 'stale' }).total).toBe(5);
    void B;
  });

  it('o resumo conta por vendedor, sem vendedor e stale por subgrupo', () => {
    const { p, g1, g2, A, B, C, cs } = basic();
    svc().replaceAssignments(admin(), p, 1, {
      set: [
        { customerId: cs[0] as number, productSubgroupId: g1, sellerId: A },
        { customerId: cs[1] as number, productSubgroupId: g1, sellerId: A },
        { customerId: cs[2] as number, productSubgroupId: g1, sellerId: B },
        { customerId: cs[0] as number, productSubgroupId: g2, sellerId: C },
      ],
    });
    const sum = svc().summary(admin(), p);
    const sg1 = sum.subgroups[0];
    expect(sg1?.productSubgroup.id).toBe(g1);
    expect(sg1?.sellers.map((x) => [x.seller.code, x.count])).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
    expect(sg1?.unassigned).toBe(1);
    expect(sum.subgroups[1]?.sellers.map((x) => [x.seller.code, x.count])).toEqual([
      ['A', 0],
      ['C', 1],
    ]);
    expect(sum.subgroups[1]?.unassigned).toBe(3);
    expect(sum.totals).toEqual({ members: 4, cells: 8, assigned: 4, unassigned: 4, stale: 0 });
  });
});

describe('distribute', () => {
  it('preenche só unassigned e stale, preserva as válidas e equilibra', () => {
    const { p, g1, g2, A, B, C, cs } = basic();
    const more = Array.from({ length: 8 }, () => customer());
    const all = [...cs, ...more];
    // Uma válida (A em g1) e uma stale (vendedor inativo em g1).
    const gone = seller('GONE');
    pair(p, gone, g1);
    svc().replaceAssignments(admin(), p, 1, {
      set: [
        { customerId: all[0] as number, productSubgroupId: g1, sellerId: B },
        { customerId: all[1] as number, productSubgroupId: g1, sellerId: gone },
      ],
    });
    sqlite().prepare('update sellers set active = 0 where id = ?').run(gone);
    const before = version(p);
    const out = svc().distribute(admin(), p, before, {});
    expect(out.aggregate.version).toBe(before + 1);
    expect(out.skippedSubgroupIds).toEqual([]);
    expect(out.distributed).toEqual({ [g1]: 11, [g2]: 12 });
    const rows = stored(p);
    expect(rows).toHaveLength(24);
    expect(rows.find((r) => r.c === all[0] && r.g === g1)?.s).toBe(B); // preservada
    expect(rows.find((r) => r.c === all[1] && r.g === g1)?.s).not.toBe(gone); // stale sobrescrita
    const countOf = (g: number) => {
      const m = new Map<number, number>();
      for (const r of rows.filter((x) => x.g === g)) m.set(r.s, (m.get(r.s) ?? 0) + 1);
      return m;
    };
    // g1: A e B (12 clientes) -> 6 e 6; g2: A e C -> 6 e 6.
    expect([...countOf(g1).entries()].sort()).toEqual(
      [
        [A, 6],
        [B, 6],
      ].sort(),
    );
    expect([...countOf(g2).entries()].sort()).toEqual(
      [
        [A, 6],
        [C, 6],
      ].sort(),
    );
    expect(svc().summary(admin(), p).totals).toMatchObject({ unassigned: 0, stale: 0, assigned: 24 });
    // Segunda execução: nada a preencher, versão sobe de novo.
    const again = svc().distribute(admin(), p, version(p), {});
    expect(again.distributed).toEqual({ [g1]: 0, [g2]: 0 });
    expect(stored(p)).toEqual(rows);
  });

  it('partindo do zero a diferença máxima entre vendedores é 1', () => {
    const p = portfolio('P');
    byState(p);
    const g = subgroup('G');
    const sellers = ['S3', 'S1', 'S2'].map((c) => seller(c));
    for (const s of sellers) pair(p, s, g);
    for (let i = 0; i < 10; i++) customer();
    svc().distribute(admin(), p, 1);
    const counts = new Map<number, number>();
    for (const r of stored(p)) counts.set(r.s, (counts.get(r.s) ?? 0) + 1);
    const values = [...counts.values()].sort();
    expect(values).toEqual([3, 3, 4]);
    // Empate pelo menor código: S1 e S2 ficam com os 4 primeiros (1,2,3 -> S1,S2,S3; 4 -> S1).
    const code = (id: number) =>
      (sqlite().prepare('select code from sellers where id = ?').get(id) as { code: string }).code;
    expect(
      stored(p)
        .slice(0, 4)
        .map((r) => code(r.s)),
    ).toEqual(['S1', 'S2', 'S3', 'S1']);
  });

  it('é determinístico entre bancos iguais', async () => {
    const run = () => {
      const { p } = basic();
      for (let i = 0; i < 17; i++) customer();
      svc().distribute(admin(), p, 1);
      return stored(p);
    };
    const first = run();
    await fx.app.close();
    await setup();
    const second = run();
    expect(second).toEqual(first);
    expect(first.length).toBe(42);
  });

  it('respeita productSubgroupIds e reporta subgrupo sem vendedor utilizável', () => {
    const { p, g1, g2, cs } = basic();
    const g3 = subgroup('G3');
    pair(p, seller('X', { active: false }), g3);
    const s = svc();
    expect(codeOf(() => s.distribute(admin(), p, 1, { productSubgroupIds: [999_999] }))).toBe(
      'validation_error',
    );
    expect(codeOf(() => s.distribute(admin(), p, 1, { productSubgroupIds: [g1, g1] }))).toBe(
      'validation_error',
    );
    expect(codeOf(() => s.distribute(admin(), p, 1, { productSubgroupIds: [] }))).toBe('validation_error');
    expect(version(p)).toBe(1);
    const out = s.distribute(admin(), p, 1, { productSubgroupIds: [g2, g3] });
    expect(out.distributed).toEqual({ [g2]: cs.length });
    expect(out.skippedSubgroupIds).toEqual([g3]);
    expect(stored(p).every((r) => r.g === g2)).toBe(true);
    const all = s.distribute(admin(), p, 2);
    expect(all.skippedSubgroupIds).toEqual([g3]);
    expect(all.distributed).toEqual({ [g1]: cs.length, [g2]: 0 });
  });

  it('não distribui cliente que perdeu a disputa nem toca nas stale fora da grade', () => {
    const { p, g1, g2, A, cs } = basic();
    const near = customer({ municipality: SERRA });
    svc().replaceAssignments(admin(), p, 1, {
      set: [{ customerId: near, productSubgroupId: g1, sellerId: A }],
    });
    byCity(portfolio('Rival'), SERRA);
    const out = svc().distribute(admin(), p, 2);
    expect(out.distributed).toEqual({ [g1]: cs.length, [g2]: cs.length });
    expect(stored(p).filter((r) => r.c === near)).toHaveLength(1); // a stale segue gravada
  });
});

describe('permissões, versão e atomicidade', () => {
  it('leitor lê (escopo) mas não escreve; responsável escreve; fora do escopo é 404', () => {
    const { p, g1, A, cs } = basic();
    const set = [{ customerId: cs[0] as number, productSubgroupId: g1, sellerId: A }];
    expect(svc().listAssignments(readerOf('SER'), p).total).toBe(8);
    expect(svc().summary(readerOf('SER'), p).totals.cells).toBe(8);
    expect(codeOf(() => svc().replaceAssignments(readerOf('SER'), p, 1, { set }))).toBe('forbidden');
    expect(codeOf(() => svc().distribute(readerOf('SER'), p, 1))).toBe('forbidden');
    expect(codeOf(() => svc().listAssignments(readerOf('XXX'), p))).toBe('not_found');
    expect(codeOf(() => svc().replaceAssignments(adminOf('XXX'), p, 1, { set }))).toBe('not_found');
    expect(svc().replaceAssignments(resp(), p, 1, { set }).version).toBe(2);
    expect(svc().distribute(resp(), p, 2).aggregate.version).toBe(3);
  });

  it('carteira inativa 409, sem versão 428, versão velha 409 (nessa ordem)', () => {
    const { p, g1, A, cs } = basic();
    const set = [{ customerId: cs[0] as number, productSubgroupId: g1, sellerId: A }];
    const s = svc();
    expect(codeOf(() => s.replaceAssignments(admin(), p, undefined, { set }))).toBe('precondition_required');
    expect(codeOf(() => s.distribute(admin(), p, undefined))).toBe('precondition_required');
    expect(codeOf(() => s.replaceAssignments(admin(), p, 7, { set }))).toBe('version_conflict');
    expect(codeOf(() => s.distribute(admin(), p, 7))).toBe('version_conflict');
    createPortfolioService(fx.db).deactivate(admin(), p, 1);
    expect(codeOf(() => s.replaceAssignments(admin(), p, 2, { set }))).toBe('portfolio_inactive');
    expect(codeOf(() => s.distribute(admin(), p, 99))).toBe('portfolio_inactive');
    expect(s.listAssignments(admin(), p).total).toBe(8); // leitura segue valendo
  });

  it('falha no meio desfaz tudo (set, clear e versão)', () => {
    const { p, g1, A, cs } = basic();
    const s = svc();
    s.replaceAssignments(admin(), p, 1, {
      set: [{ customerId: cs[0] as number, productSubgroupId: g1, sellerId: A }],
    });
    const before = stored(p);
    // Gatilho que aborta a inserção do cliente cs[3].
    sqlite().exec(
      `create trigger boom before insert on portfolio_assignments when new.customer_id = ${cs[3]} begin select raise(abort, 'boom'); end`,
    );
    expect(() =>
      s.replaceAssignments(admin(), p, 2, {
        clear: [{ customerId: cs[0] as number, productSubgroupId: g1 }],
        set: [
          { customerId: cs[1] as number, productSubgroupId: g1, sellerId: A },
          { customerId: cs[3] as number, productSubgroupId: g1, sellerId: A },
        ],
      }),
    ).toThrow();
    expect(stored(p)).toEqual(before);
    expect(version(p)).toBe(2);
    expect(() => s.distribute(admin(), p, 2)).toThrow();
    expect(stored(p)).toEqual(before);
    expect(version(p)).toBe(2);
  });
});

describe('estratégia balanced', () => {
  const sellers = [
    { id: 1, code: 'B' },
    { id: 2, code: 'A' },
    { id: 3, code: 'C' },
  ];
  it('considera as contagens válidas existentes e desempata pelo código', () => {
    const out = balancedStrategy.assign({
      sellers,
      validCounts: new Map([[2, 2]]),
      customerIds: [10, 11, 12, 13, 14],
    });
    // A(2), B(0), C(0): B, C, depois A/B/C empatam em 1,1,2 -> B(1)... confere contra simulação ingênua.
    const count = new Map<number, number>([[2, 2]]);
    const naive: number[] = [];
    for (let i = 0; i < 5; i++) {
      const pick = [...sellers].sort(
        (x, y) => (count.get(x.id) ?? 0) - (count.get(y.id) ?? 0) || (x.code < y.code ? -1 : 1),
      )[0] as { id: number };
      naive.push(pick.id);
      count.set(pick.id, (count.get(pick.id) ?? 0) + 1);
    }
    expect(out).toEqual(naive);
  });
});
