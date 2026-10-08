import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDistributionService } from '../../src/domain/distribution/service.js';
import { createLinkService } from '../../src/domain/links/service.js';
import { neighborhoodKey } from '../../src/domain/shared/normalize.js';
import { adminOf, ES, SERRA, VITORIA, makeFixture, seedBranch, type Fixture } from '../helpers/seed.js';

/**
 * Volume do E7: 50 mil membros efetivos x 3 subgrupos x 10 vendedores (150 mil vínculos e 150 mil
 * eventos na 1ª finalização). Mede a 1ª finalização, a re-finalização após trocar 1% das células e as
 * páginas de `listLinks` e `listLinkEvents`, e confere o resultado com uma contagem INDEPENDENTE em JS
 * sobre as tabelas. Os tetos de tempo só valem com PERF_ASSERT=1 (`pnpm --filter @meugmill/api test:perf`).
 */

const NOW = 1_700_000_000_000;
const ASSERT_TIMING = process.env.PERF_ASSERT === '1';
const FIRST_CEILING_MS = 5000;
const REFINALIZE_CEILING_MS = 2000;
const READ_CEILING_MS = 1500;

const MEMBERS = 50_000;
const LOST = 2_000; // clientes de Serra: a carteira rival ganha a disputa
const SUBGROUPS = 3;
const SELLERS = 10;
const CELLS = MEMBERS * SUBGROUPS;

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
  branch: number;
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
  return { p, subgroups, sellers, members, branch: ser };
}

interface LinkRow {
  id: number;
  c: number;
  g: number;
  s: number;
  active: number;
  valid_to: number | null;
}
interface Cell {
  c: number;
  g: number;
  s: number;
}

const links = (): LinkRow[] =>
  sq()
    .prepare(
      'select id, customer_id as c, product_subgroup_id as g, seller_id as s, active, valid_to from portfolio_links',
    )
    .all() as LinkRow[];
const eventCounts = () =>
  sq()
    .prepare(
      "select coalesce(sum(kind = 'created'), 0) as created, coalesce(sum(kind = 'ended'), 0) as ended from portfolio_link_events",
    )
    .get() as { created: number; ended: number };
const storedCells = (p: number): Cell[] =>
  sq()
    .prepare(
      'select customer_id as c, product_subgroup_id as g, seller_id as s from portfolio_assignments where portfolio_id = ?',
    )
    .all(p) as Cell[];

/** Conferência independente: ativos = células gravadas (mesmo vendedor), sem duplicado ativo por célula. */
function verifyActive(w: World, expected: Cell[]): void {
  const seen = new Set<string>();
  const want = new Map(expected.map((x) => [`${x.c}.${x.g}`, x.s]));
  const memberSet = new Set(w.members);
  let active = 0;
  for (const l of links()) {
    if (l.active !== 1) continue;
    active++;
    const key = `${l.c}.${l.g}`;
    if (seen.has(key)) throw new Error('vínculo ativo duplicado na célula');
    seen.add(key);
    if (!memberSet.has(l.c)) throw new Error('vínculo para quem não é membro');
    if (want.get(key) !== l.s) throw new Error('vendedor do vínculo difere da atribuição');
  }
  expect(active).toBe(expected.length);
  expect(seen.size).toBe(CELLS);
}

describe('vínculos: volume (50 mil membros x 3 subgrupos x 10 vendedores)', () => {
  it('1ª finalização, re-finalização (1% das células) e páginas dentro dos tetos', () => {
    const w = seed();
    const distribution = createDistributionService(fx.db, { now: () => NOW });
    let clock = NOW;
    const svc = createLinkService(fx.db, { now: () => clock });
    distribution.distribute(admin, w.p, 1); // p v2

    // 1) Primeira finalização: 150 mil vínculos e 150 mil eventos.
    clock = NOW + 1000;
    const [first, tFirst] = time(() => svc.finalize(admin, w.p, 2));
    expect(first).toMatchObject({ created: CELLS, ended: 0, kept: 0 });
    expect(first.aggregate.status).toBe('active');
    const cells1 = storedCells(w.p);
    verifyActive(w, cells1);
    expect(links()).toHaveLength(CELLS);
    expect(eventCounts()).toEqual({ created: CELLS, ended: 0 });

    // 2) Troca o vendedor de 1% das células (direto nas atribuições) e re-finaliza.
    const sellerIdx = new Map(w.sellers.map((s, i) => [s, i]));
    const change = new Map<string, number>();
    const upd = sq().prepare(
      'update portfolio_assignments set seller_id = ? where portfolio_id = ? and customer_id = ? and product_subgroup_id = ?',
    );
    sq().transaction(() => {
      cells1.forEach((x, i) => {
        if (i % 100 !== 0) return;
        const next = w.sellers[((sellerIdx.get(x.s) as number) + 1) % SELLERS] as number;
        upd.run(next, w.p, x.c, x.g);
        change.set(`${x.c}.${x.g}`, next);
      });
    })();
    const changed = change.size;
    expect(changed).toBe(CELLS / 100);
    clock = NOW + 2000;
    const [second, tSecond] = time(() => svc.finalize(admin, w.p, 3));
    expect(second).toMatchObject({ created: changed, ended: changed, kept: CELLS - changed });
    const cells2 = storedCells(w.p);
    verifyActive(w, cells2);
    const all = links();
    expect(all).toHaveLength(CELLS + changed);
    expect(all.filter((l) => l.active === 0 && l.valid_to === clock)).toHaveLength(changed);
    expect(eventCounts()).toEqual({ created: CELLS + changed, ended: changed });

    // 3) Re-finalizar sem mudanças: nada a gravar.
    const [third, tNoop] = time(() => svc.finalize(admin, w.p, 4));
    expect(third).toMatchObject({ created: 0, ended: 0, kept: CELLS });

    // 4) Leituras paginadas.
    const [page, tLinks] = time(() => svc.listLinks(admin, w.p, { limit: 200 }));
    expect(page.items).toHaveLength(200);
    expect(page.total).toBe(CELLS);
    const [pageFiltered, tLinksFiltered] = time(() =>
      svc.listLinks(admin, w.p, {
        productSubgroupId: w.subgroups[1] as number,
        sellerId: w.sellers[4] as number,
        limit: 50,
        cursor: page.nextCursor as string,
      }),
    );
    expect(pageFiltered.total).toBeGreaterThan(0);
    const [events, tEvents] = time(() => svc.listLinkEvents(admin, { after: 80_000, limit: 1000 }));
    expect(events.items).toHaveLength(1000);
    expect(events.items[0]?.id).toBe(80_001);
    expect(events.hasMore).toBe(true);
    const [eventsAll, tEventsAll] = time(() =>
      svc.listLinkEvents(admin, { branchId: w.branch, limit: 1000 }),
    );
    expect(eventsAll.items).toHaveLength(1000);

    console.log(
      `[volume vinculos] membros=${MEMBERS} celulas=${CELLS}\n` +
        `  1a finalizacao (150k vinculos + 150k eventos)=${tFirst.toFixed(0)}ms | re-finalizacao 1% (${changed} trocas)=${tSecond.toFixed(0)}ms | re-finalizacao sem mudanca=${tNoop.toFixed(0)}ms\n` +
        `  listLinks limit200=${tLinks.toFixed(0)}ms | listLinks filtrado=${tLinksFiltered.toFixed(0)}ms | listLinkEvents after=80k limit1000=${tEvents.toFixed(0)}ms | listLinkEvents inicio=${tEventsAll.toFixed(0)}ms`,
    );
    const plans = [
      [
        'vinculos ativos da carteira',
        'select id, customer_id, product_subgroup_id, seller_id from portfolio_links where portfolio_id = ? and active = 1 order by id',
      ],
      [
        'conflito entre carteiras',
        "with cells as materialized (select json_extract(value, '$[0]') as c, json_extract(value, '$[1]') as g from json_each('[[1,1,1]]')) select distinct l.portfolio_id from cells cross join portfolio_links l on l.branch_id = 1 and l.customer_id = cells.c and l.product_subgroup_id = cells.g and l.active = 1 where l.portfolio_id <> ?",
      ],
      [
        'eventos',
        'select e.id from portfolio_link_events e where e.branch_id = 1 and e.id > 100 order by e.id limit 1001',
      ],
    ] as const;
    for (const [label, text] of plans) {
      const plan = (
        sq()
          .prepare(`explain query plan ${text.replace(/\?/g, String(w.p))}`)
          .all() as { detail: string }[]
      ).map((r) => '    ' + r.detail);
      console.log(`[volume vinculos] EXPLAIN ${label}:\n${plan.join('\n')}`);
    }

    if (!ASSERT_TIMING) return;
    expect(tFirst).toBeLessThan(FIRST_CEILING_MS);
    expect(tSecond).toBeLessThan(REFINALIZE_CEILING_MS);
    for (const t of [tNoop, tLinks, tLinksFiltered, tEvents, tEventsAll]) {
      expect(t).toBeLessThan(READ_CEILING_MS);
    }
  }, 300_000);
});
