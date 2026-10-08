import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDistributionService } from '../../src/domain/distribution/service.js';
import { adminOf, ES, SERRA, VITORIA, makeFixture, seedBranch, type Fixture } from '../helpers/seed.js';
import { neighborhoodKey } from '../../src/domain/shared/normalize.js';

/**
 * Volume do E6: 50 mil membros efetivos x 3 subgrupos x 10 vendedores (150 mil células). Mede
 * `distribute` (do zero e incremental), páginas de `listAssignments` (com e sem filtro de status) e
 * `summary`, e confere o resultado com uma contagem INDEPENDENTE em JS sobre as tabelas. Os tetos de
 * tempo só valem com PERF_ASSERT=1 (`pnpm --filter @meugmill/api test:perf`), como no volume do E5.
 */

const NOW = 1_700_000_000_000;
const ASSERT_TIMING = process.env.PERF_ASSERT === '1';
const DISTRIBUTE_CEILING_MS = 5000;
const READ_CEILING_MS = 1500;

const MEMBERS = 50_000;
const LOST = 2_000; // clientes de Serra: a carteira rival ganha a disputa
const SUBGROUPS = 3;
const SELLERS = 10;

let fx: Fixture;

beforeEach(async () => {
  fx = await makeFixture();
});
afterEach(async () => {
  await fx.app.close();
});

const sq = () => fx.app.sqlite;
const admin = adminOf('SER');

function time<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const r = fn();
  return [r, performance.now() - t0];
}

interface World {
  p: number;
  subgroups: number[];
  sellers: number[]; // em ordem de código V00..V09
  members: number[]; // ids ordenados dos membros efetivos
}

function seed(): World {
  const ser = seedBranch(fx.db, 'SER');
  const typeId = sq()
    .prepare(
      `insert into portfolio_types (code, name, name_key, created_at, updated_at, created_by, updated_by)
       values ('T','Tipo','TIPO',?,?,'t','t')`,
    )
    .run(NOW, NOW).lastInsertRowid as number;
  const insC = sq().prepare(
    `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
      neighborhood_key, active, created_at, updated_at, created_by, updated_by)
     values (?,?,?,?,?,?,?,1,?,?,'t','t')`,
  );
  const insL = sq().prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,1)');
  const members: number[] = [];
  const hood = 'Centro';
  sq().transaction(() => {
    for (let i = 0; i < MEMBERS + LOST; i++) {
      const lost = i % 26 === 25; // 2.000 dos 52.000, espalhados
      const id = insC.run(
        String(i + 1).padStart(14, '0'),
        `Cliente ${i}`,
        `CLIENTE ${i}`,
        ES,
        lost ? SERRA : VITORIA,
        hood,
        neighborhoodKey(hood),
        NOW,
        NOW,
      ).lastInsertRowid as number;
      insL.run(id, ser);
      if (!lost) members.push(id);
    }
  })();
  const insP = sq().prepare(
    `insert into portfolios (branch_id, name, name_key, responsible_sub, portfolio_type_id, status, active,
      created_at, updated_at, created_by, updated_by) values (?,?,?,'resp',?,'draft',1,?,?,'t','t')`,
  );
  const p = insP.run(ser, 'P', 'P', typeId, NOW, NOW).lastInsertRowid as number;
  const rival = insP.run(ser, 'Rival', 'RIVAL', typeId, NOW, NOW).lastInsertRowid as number;
  sq()
    .prepare("insert into portfolio_regions (portfolio_id, level, state_code) values (?,'state',?)")
    .run(p, ES);
  sq()
    .prepare(
      "insert into portfolio_regions (portfolio_id, level, state_code, municipality_code) values (?,'municipality',?,?)",
    )
    .run(rival, ES, SERRA);
  const subgroups = Array.from(
    { length: SUBGROUPS },
    (_, i) =>
      sq()
        .prepare(
          `insert into product_subgroups (code, name, name_key, created_at, updated_at, created_by, updated_by)
           values (?,?,?,?,?,'t','t')`,
        )
        .run(`G${i}`, `Subgrupo ${i}`, `G${i}`, NOW, NOW).lastInsertRowid as number,
  );
  const sellers = Array.from({ length: SELLERS }, (_, i) => {
    const code = `V${String(i).padStart(2, '0')}`;
    const id = sq()
      .prepare(
        `insert into sellers (code, name, name_key, created_at, updated_at, created_by, updated_by)
         values (?,?,?,?,?,'t','t')`,
      )
      .run(code, `Vendedor ${code}`, code, NOW, NOW).lastInsertRowid as number;
    sq().prepare('insert into seller_branches (seller_id, branch_id, active) values (?,?,1)').run(id, ser);
    for (const g of subgroups) {
      sq()
        .prepare(
          'insert into portfolio_sellers (portfolio_id, seller_id, product_subgroup_id) values (?,?,?)',
        )
        .run(p, id, g);
    }
    return id;
  });
  return { p, subgroups, sellers, members };
}

interface Row {
  c: number;
  g: number;
  s: number;
}
const storedRows = (p: number): Row[] =>
  sq()
    .prepare(
      'select customer_id as c, product_subgroup_id as g, seller_id as s from portfolio_assignments where portfolio_id = ?',
    )
    .all(p) as Row[];

/** Conferência independente: células únicas, cobertura total, validade e equilíbrio por subgrupo. */
function verify(w: World, activeSellers: number[], rows: Row[]) {
  const memberSet = new Set(w.members);
  const seen = new Set<string>();
  const perCell = new Map<number, Map<number, number>>(w.subgroups.map((g) => [g, new Map()]));
  for (const r of rows) {
    const key = `${r.c}.${r.g}`;
    if (seen.has(key)) throw new Error('célula duplicada');
    seen.add(key);
    if (!memberSet.has(r.c)) throw new Error('atribuição a quem não é membro');
    if (!activeSellers.includes(r.s)) throw new Error('vendedor inválido');
    const m = perCell.get(r.g) as Map<number, number>;
    m.set(r.s, (m.get(r.s) ?? 0) + 1);
  }
  expect(rows.length).toBe(w.members.length * SUBGROUPS);
  for (const g of w.subgroups) {
    const counts = activeSellers.map((s) => (perCell.get(g) as Map<number, number>).get(s) ?? 0);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(w.members.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  }
}

describe('distribuição: volume (50 mil membros x 3 subgrupos x 10 vendedores)', () => {
  it('distribute do zero e incremental, páginas e resumo dentro dos tetos', () => {
    const w = seed();
    const svc = createDistributionService(fx.db, { now: () => NOW });
    const cursorAt = (k: number, g: number) =>
      Buffer.from(`${w.members[k]}.${g}`, 'utf8').toString('base64url');
    const g0 = w.subgroups[0] as number;
    const g1 = w.subgroups[1] as number;

    // Antes: tudo unassigned (a página usa o cursor do meio da grade).
    const [pre, tPre] = time(() =>
      svc.listAssignments(admin, w.p, { limit: 50, cursor: cursorAt(25_000, g0) }),
    );
    expect(pre.total).toBe(MEMBERS * SUBGROUPS);
    expect(pre.items[0]?.customer.id).toBe(w.members[25_000]);
    expect(pre.items[0]?.productSubgroup.id).toBe(g1);

    // 1) Do zero.
    const [first, tFirst] = time(() => svc.distribute(admin, w.p, 1));
    expect(first.distributed).toEqual(Object.fromEntries(w.subgroups.map((g) => [g, MEMBERS])));
    const rows = storedRows(w.p);
    verify(w, w.sellers, rows);
    // Do zero, o cliente k de cada subgrupo vai para o vendedor k mod 10 (menor contagem, empate por código).
    const index = new Map(w.members.map((c, k) => [c, k]));
    for (const r of rows) {
      if (r.s !== w.sellers[(index.get(r.c) as number) % SELLERS]) throw new Error('vendedor inesperado');
    }

    const [pageAssigned, tAssigned] = time(() =>
      svc.listAssignments(admin, w.p, { limit: 50, status: 'assigned', cursor: cursorAt(25_000, g1) }),
    );
    expect(pageAssigned.total).toBe(MEMBERS * SUBGROUPS);
    expect(pageAssigned.items).toHaveLength(50);
    const [pagePlain, tPlain] = time(() => svc.listAssignments(admin, w.p, { limit: 200 }));
    expect(pagePlain.items[0]?.customer.id).toBe(w.members[0]);
    const [sum, tSum] = time(() => svc.summary(admin, w.p));
    expect(sum.totals).toEqual({
      members: MEMBERS,
      cells: MEMBERS * SUBGROUPS,
      assigned: MEMBERS * SUBGROUPS,
      unassigned: 0,
      stale: 0,
    });
    for (const sg of sum.subgroups) {
      expect(sg.sellers.map((x) => x.count)).toEqual(Array(SELLERS).fill(MEMBERS / SELLERS));
    }

    // 2) Incremental: apaga 5 mil células (seleção determinística) e inativa um vendedor (15 mil
    // células ficam stale). O resto é preservado.
    const gone = w.sellers[3] as number;
    const wipe = rows.filter((r, i) => i % 30 === 7 && r.s !== gone).slice(0, 5000);
    sq().transaction(() => {
      const del = sq().prepare(
        'delete from portfolio_assignments where portfolio_id = ? and customer_id = ? and product_subgroup_id = ?',
      );
      for (const r of wipe) del.run(w.p, r.c, r.g);
    })();
    sq().prepare('update sellers set active = 0 where id = ?').run(gone);
    const [stalePage, tStale] = time(() => svc.listAssignments(admin, w.p, { limit: 50, status: 'stale' }));
    const staleExpected = (MEMBERS * SUBGROUPS) / SELLERS - wipe.filter((r) => r.s === gone).length;
    expect(stalePage.total).toBe(staleExpected);
    const keep = new Map(rows.filter((r) => r.s !== gone).map((r) => [`${r.c}.${r.g}`, r.s]));
    for (const r of wipe) keep.delete(`${r.c}.${r.g}`);

    const [second, tSecond] = time(() => svc.distribute(admin, w.p, 2));
    expect(Object.values(second.distributed).reduce((a, b) => a + b, 0)).toBe(
      MEMBERS * SUBGROUPS - keep.size,
    );
    const after = storedRows(w.p);
    verify(
      w,
      w.sellers.filter((s) => s !== gone),
      after,
    );
    for (const r of after) {
      const was = keep.get(`${r.c}.${r.g}`);
      if (was !== undefined && was !== r.s) throw new Error('atribuição válida não foi preservada');
    }
    const [sum2, tSum2] = time(() => svc.summary(admin, w.p));
    expect(sum2.totals).toMatchObject({ assigned: MEMBERS * SUBGROUPS, unassigned: 0, stale: 0 });

    console.log(
      `[volume distribuicao] membros=${MEMBERS} celulas=${MEMBERS * SUBGROUPS}\n` +
        `  distribute do zero=${tFirst.toFixed(0)}ms | incremental=${tSecond.toFixed(0)}ms\n` +
        `  pagina50 (tudo unassigned)=${tPre.toFixed(0)}ms | status=assigned=${tAssigned.toFixed(0)}ms | limit200 sem filtro=${tPlain.toFixed(0)}ms | status=stale=${tStale.toFixed(0)}ms\n` +
        `  summary=${tSum.toFixed(0)}ms | summary apos incremental=${tSum2.toFixed(0)}ms`,
    );
    const plans = [
      [
        'leitura das atribuicoes',
        'select customer_id as c, product_subgroup_id as g, seller_id as s from portfolio_assignments where portfolio_id = ? order by customer_id, product_subgroup_id',
      ],
      [
        'pares da carteira',
        'select ps.product_subgroup_id, ps.seller_id from portfolio_sellers ps join sellers s on s.id = ps.seller_id where ps.portfolio_id = ?',
      ],
      [
        'delete do clear',
        "delete from portfolio_assignments where portfolio_id = ? and (customer_id, product_subgroup_id) in (select json_extract(value, '$[0]'), json_extract(value, '$[1]') from json_each('[[1,1]]'))",
      ],
    ] as const;
    for (const [label, text] of plans) {
      const plan = (sq().prepare(`explain query plan ${text}`).all(w.p) as { detail: string }[]).map(
        (r) => '    ' + r.detail,
      );
      console.log(`[volume distribuicao] EXPLAIN ${label}:\n${plan.join('\n')}`);
    }

    if (!ASSERT_TIMING) return;
    expect(tFirst).toBeLessThan(DISTRIBUTE_CEILING_MS);
    expect(tSecond).toBeLessThan(DISTRIBUTE_CEILING_MS);
    for (const t of [tPre, tAssigned, tPlain, tStale, tSum, tSum2]) expect(t).toBeLessThan(READ_CEILING_MS);
  }, 300_000);
});
