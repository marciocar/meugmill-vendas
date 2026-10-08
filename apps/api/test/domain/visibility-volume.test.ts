import { sql } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVisibilityService } from '../../src/domain/visibility/service.js';
import { visibleCustomersSql } from '../../src/domain/visibility/sql.js';
import { neighborhoodKey } from '../../src/domain/shared/normalize.js';
import { actor, ES, SERRA, makeFixture, seedBranch, type Fixture } from '../helpers/seed.js';

/**
 * Volume do E8: 50 mil clientes x 3 subgrupos = 150 mil vínculos ativos. O vendedor V00 tem 15 mil clientes
 * (45 mil vínculos); os outros 35 mil se dividem entre 9 vendedores. Mede `listMyCustomers` (página, com
 * total e `via`) e `check` com 1.000 ids, e confere o resultado com uma contagem INDEPENDENTE em JS sobre
 * a tabela. Os tetos só valem com PERF_ASSERT=1 (`pnpm --filter @meugmill/api test:perf`).
 */

const NOW = 1_700_000_000_000;
const ASSERT_TIMING = process.env.PERF_ASSERT === '1';
const CEILING_MS = 300;

const CUSTOMERS = 50_000;

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

function time<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const r = fn();
  return [r, performance.now() - t0];
}
/** Menor de N execuções (a 1ª é "fria" e fica registrada à parte). */
function best<T>(n: number, fn: () => T): [T, number, number] {
  const [r, cold] = time(fn);
  let warm = cold;
  for (let i = 1; i < n; i++) warm = Math.min(warm, time(fn)[1]);
  return [r, cold, warm];
}

describe('visibilidade: volume (150 mil vínculos ativos, vendedor com 15 mil clientes)', () => {
  it('listMyCustomers e check(1000) dentro do teto, conferidos em JS', () => {
    const ser = seedBranch(fx.db, 'SER');
    const typeId = sq()
      .prepare(
        `insert into portfolio_types (code, name, name_key, created_at, updated_at, created_by, updated_by)
         values ('T','Tipo','TIPO',?,?,'t','t')`,
      )
      .run(NOW, NOW).lastInsertRowid as number;
    const insP = sq().prepare(
      `insert into portfolios (branch_id, name, name_key, responsible_sub, portfolio_type_id, status, active,
        created_at, updated_at, created_by, updated_by) values (?,?,?,?,?,'active',1,?,?,'t','t')`,
    );
    const p = insP.run(ser, 'P', 'P', 'gestor-1', typeId, NOW, NOW).lastInsertRowid as number;
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
          `insert into sellers (code, name, name_key, user_sub, created_at, updated_at, created_by, updated_by)
           values (?,?,?,?,?,?,'t','t')`,
        )
        .run(code, `Vendedor ${code}`, code, `sub-${code}`, NOW, NOW).lastInsertRowid as number;
      sq().prepare('insert into seller_branches (seller_id, branch_id, active) values (?,?,1)').run(id, ser);
      return id;
    });

    const insC = sq().prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
        neighborhood_key, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,?,1,?,?,'t','t')`,
    );
    const insB = sq().prepare(
      'insert into customer_branches (customer_id, branch_id, active) values (?,?,1)',
    );
    const insL = sq().prepare(
      `insert into portfolio_links (portfolio_id, branch_id, customer_id, product_subgroup_id, seller_id, active,
        valid_from, created_by) values (?,?,?,?,?,1,?,'t')`,
    );
    const hood = 'Centro';
    const customerIds: number[] = [];
    sq().transaction(() => {
      for (let i = 0; i < CUSTOMERS; i++) {
        const id = insC.run(
          String(i + 1).padStart(14, '0'),
          `Cliente ${i}`,
          `CLIENTE ${i}`,
          ES,
          SERRA,
          hood,
          neighborhoodKey(hood),
          NOW,
          NOW,
        ).lastInsertRowid as number;
        insB.run(id, ser);
        customerIds.push(id);
        // espalha os 15 mil de V00 (3 em cada 10); o resto roda entre V01..V09
        const mineHere = i % 10 < 3;
        const owner = mineHere ? sellers[0] : sellers[1 + (i % (SELLERS - 1))];
        for (const g of subgroups) insL.run(p, ser, id, g, owner as number, NOW);
      }
    })();

    // Conferência independente (JS puro sobre a tabela): clientes com vínculo ativo do V00 e do gestor.
    const rows = sq()
      .prepare('select customer_id as c, seller_id as s from portfolio_links where active = 1')
      .all() as { c: number; s: number }[];
    expect(rows).toHaveLength(CUSTOMERS * SUBGROUPS);
    const expected = [...new Set(rows.filter((r) => r.s === sellers[0]).map((r) => r.c))].sort(
      (a, b) => a - b,
    );
    expect(expected.length).toBeGreaterThanOrEqual(14_000);
    expect(expected.length).toBeLessThanOrEqual(16_000);
    const expectedSet = new Set(expected);

    const svc = createVisibilityService(fx.db, { now: () => NOW });
    const seller0 = actor({ sub: 'sub-V00', roles: ['vendedor'], branches: ['SER'] });

    // 1) listMyCustomers: 1ª página (limit 200) e uma página do meio, com total e via.
    const [first, coldFirst, warmFirst] = best(3, () => svc.listMyCustomers(seller0, { limit: 200 }));
    expect(first.total).toBe(expected.length);
    expect(first.items.map((i) => i.id)).toEqual(expected.slice(0, 200));
    expect(
      first.items.every((i) => i.via.length === SUBGROUPS && i.via.every((v) => v.profile === 'vendedor')),
    ).toBe(true);
    const mid = svc.listMyCustomers(seller0, { limit: 200, cursor: first.nextCursor as string });
    const [midPage, coldMid, warmMid] = best(3, () =>
      svc.listMyCustomers(seller0, { limit: 200, cursor: first.nextCursor as string }),
    );
    expect(midPage.items.map((i) => i.id)).toEqual(expected.slice(200, 400));
    expect(mid.total).toBe(expected.length);
    const [bySubgroup, , warmSubgroup] = best(2, () =>
      svc.listMyCustomers(seller0, { productSubgroupId: subgroups[1] as number, limit: 200 }),
    );
    expect(bySubgroup.total).toBe(expected.length);
    const [byQuery, , warmQuery] = best(2, () => svc.listMyCustomers(seller0, { q: 'cliente 1', limit: 50 }));
    expect(byQuery.items.every((i) => expectedSet.has(i.id))).toBe(true);

    // 2) Percorre tudo uma vez (sem tempo): a união das páginas é exatamente o esperado.
    const walked: number[] = [];
    for (let cursor: string | undefined; ;) {
      const page = svc.listMyCustomers(seller0, { limit: 200, ...(cursor ? { cursor } : {}) });
      walked.push(...page.items.map((i) => i.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(walked).toEqual(expected);

    // 3) check com 1.000 ids: metade do V00 e metade de outros clientes, mais um id inexistente.
    const others = customerIds.filter((id) => !expectedSet.has(id));
    const ask = [
      ...expected.filter((_, i) => i % 15 === 0).slice(0, 499),
      ...others.filter((_, i) => i % 35 === 0).slice(0, 500),
      999_999_999,
    ];
    expect(ask).toHaveLength(1000);
    const want = ask.filter((id) => expectedSet.has(id)).sort((a, b) => a - b);
    const [checked, coldCheck, warmCheck] = best(3, () => svc.check(seller0, ask));
    expect(checked.visible).toEqual(want);
    expect(want).toHaveLength(499);
    // todos os ids do V00 em lotes de 1.000: nenhum falso positivo/negativo
    const seen: number[] = [];
    for (let i = 0; i < customerIds.length; i += 1000) {
      seen.push(...svc.check(seller0, customerIds.slice(i, i + 1000)).visible);
    }
    expect(seen).toEqual(expected);

    // 4) Gestor (carteira única) e admin, só medidos: vêem todos os 50 mil.
    const gestor = actor({ sub: 'gestor-1', roles: ['gestor'], branches: ['SER'] });
    const admin = actor({ sub: 'a', roles: ['admin'], branches: ['SER'] });
    const [gPage, , warmGestor] = best(2, () => svc.listMyCustomers(gestor, { limit: 200 }));
    expect(gPage.total).toBe(CUSTOMERS);
    const [aCheck, , warmAdminCheck] = best(2, () => svc.check(admin, ask));
    expect(aCheck.visible).toHaveLength(999);
    const [summary, , warmSummary] = best(2, () => svc.summary(seller0));
    expect(summary.visibleCustomers).toBe(expected.length);

    console.log(
      `[volume visibilidade] clientes=${CUSTOMERS} vinculos=${CUSTOMERS * SUBGROUPS} visiveis(V00)=${expected.length}\n` +
        `  listMyCustomers 1a pagina: fria=${coldFirst.toFixed(0)}ms quente=${warmFirst.toFixed(0)}ms | pagina do meio: fria=${coldMid.toFixed(0)}ms quente=${warmMid.toFixed(0)}ms\n` +
        `  listMyCustomers subgrupo=${warmSubgroup.toFixed(0)}ms | q=${warmQuery.toFixed(0)}ms | gestor(50k)=${warmGestor.toFixed(0)}ms\n` +
        `  check(1000): frio=${coldCheck.toFixed(0)}ms quente=${warmCheck.toFixed(0)}ms | admin=${warmAdminCheck.toFixed(0)}ms | summary(V00)=${warmSummary.toFixed(0)}ms`,
    );
    const dialect = new SQLiteSyncDialect();
    const plans: [string, ReturnType<typeof visibleCustomersSql>][] = [
      ['visiveis do vendedor (listMyCustomers / restricoes)', visibleCustomersSql(seller0, false)],
      ['visiveis do vendedor restritos a 1.000 ids (check)', visibleCustomersSql(seller0, false, ask)],
    ];
    for (const [label, query] of plans) {
      const q = dialect.sqlToQuery(sql`explain query plan ${query}`);
      const plan = (
        sq()
          .prepare(q.sql)
          .all(...q.params) as { detail: string }[]
      ).map((r) => '    ' + r.detail);
      console.log(`[volume visibilidade] EXPLAIN ${label}:\n${plan.join('\n')}`);
    }

    if (!ASSERT_TIMING) return;
    for (const t of [coldFirst, warmFirst, coldMid, warmMid, coldCheck, warmCheck]) {
      expect(t).toBeLessThan(CEILING_MS);
    }
  }, 300_000);
});
