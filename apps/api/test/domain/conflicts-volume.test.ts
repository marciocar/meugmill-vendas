import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectiveMembers } from '../../src/domain/conflicts/members.js';
import {
  conflictCountsSql,
  loadPortfolioCriteria,
  previewIdsSql,
  previewPage,
  type Resolution,
} from '../../src/domain/eligibility/query.js';
import { createPortfolioService } from '../../src/domain/portfolios/service.js';
import { adminOf } from '../helpers/seed.js';
import { encodeCursor } from '../../src/domain/shared/pagination.js';
import { neighborhoodKey } from '../../src/domain/shared/normalize.js';
import {
  ES,
  SP,
  makeFixture,
  seedBranch,
  seedEconomicGroup,
  seedRetailNetwork,
  type Fixture,
} from '../helpers/seed.js';

/**
 * Volume sintético do pior caso realista da disputa entre carteiras. Mede a página da prévia (com e
 * sem `resolution`), o agregado (contagens de conflito) e `effectiveMembers`, e confere o resultado
 * contra uma contagem INDEPENDENTE feita em JS a partir das tabelas (sem passar pela SQL do motor).
 */

const NOW = 1_700_000_000_000;
/** Teto de latência (ms) de cada operação, na meta do contexto da entrega. */
const CEILING_MS = 1500;
/**
 * Os tetos de TEMPO só são afirmados no comando `pnpm --filter @meugmill/api test:perf`, que roda os
 * testes de volume isolados (sem outros arquivos disputando CPU). Na suíte comum e no CI os tempos são
 * impressos, mas não afirmados: medida de latência sob contenção é ruído, e um teste intermitente
 * ensina o time a ignorar o vermelho. A conferência de RESULTADO (contagem independente) roda sempre.
 */
const ASSERT_TIMING = process.env.PERF_ASSERT === '1';

/** Tetos (ms) por cenário: operações baratas (sem disputa) e operações que resolvem a disputa. */
interface Ceilings {
  /** Página sem `resolution` e GET do agregado. */
  cheap: number;
  /** Página com `resolution`, contagens (`include=conflicts`) e `effectiveMembers`. */
  resolve: number;
}

let fx: Fixture;
let ser: number;
let car: number;
let typeId: number;
let munis: { code: number; st: number }[];
let nets: number[];
let grps: number[];

beforeEach(async () => {
  fx = await makeFixture();
  ser = seedBranch(fx.db, 'SER');
  car = seedBranch(fx.db, 'CAR');
  typeId = fx.app.sqlite
    .prepare(
      `insert into portfolio_types (code, name, name_key, created_at, updated_at, created_by, updated_by)
       values ('T','Tipo','TIPO',?,?,'t','t')`,
    )
    .run(NOW, NOW).lastInsertRowid as number;
  const all = fx.app.sqlite
    .prepare(
      'select ibge_code as code, state_code as st from municipalities where state_code in (32, 35) order by ibge_code',
    )
    .all() as { code: number; st: number }[];
  // 20 municípios do ES e 10 de SP.
  munis = [...all.filter((m) => m.st === ES).slice(0, 20), ...all.filter((m) => m.st === SP).slice(0, 10)];
  nets = Array.from({ length: 8 }, (_, i) => seedRetailNetwork(fx.db, `VR${i}`));
  grps = Array.from({ length: 5 }, (_, i) => seedEconomicGroup(fx.db, `VG${i}`));
});
afterEach(async () => {
  await fx.app.close();
});

const sq = () => fx.app.sqlite;

/** Clientes da filial `ser` (50 mil, quase todos ativos e vinculados) e, opcionalmente, de OUTRA filial. */
function seedCustomers(own: number, other: number): void {
  const insC = sq().prepare(
    `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
      neighborhood_key, retail_network_id, economic_group_id, active, created_at, updated_at, created_by, updated_by)
     values (?,?,?,?,?,?,?,?,?,?,?,?,'t','t')`,
  );
  const insL = sq().prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,?)');
  const add = (i: number, branch: number, shared: boolean) => {
    // Os clientes da outra filial ficam nos municípios do ES (mesma UF das carteiras da filial).
    const m = (branch === ser ? munis[i % munis.length] : munis[i % 20]) as { code: number; st: number };
    const hood = `Bairro ${i % 12}`;
    const id = insC.run(
      String(i + 1 + (branch === ser ? 0 : 10_000_000)).padStart(14, '0'),
      `Cliente ${i}`,
      `CLIENTE ${i}`,
      m.st,
      m.code,
      hood,
      neighborhoodKey(hood),
      i % 3 === 0 ? (nets[i % nets.length] as number) : null,
      i % 4 === 0 ? (grps[i % grps.length] as number) : null,
      i % 50 === 0 ? 0 : 1,
      NOW,
      NOW,
    ).lastInsertRowid as number;
    insL.run(id, branch, branch === ser && i % 40 === 0 ? 0 : 1);
    if (shared) insL.run(id, car, 1);
  };
  sq().transaction(() => {
    for (let i = 0; i < own; i++) add(i, ser, i % 7 === 0);
    for (let i = 0; i < other; i++) add(i, car, false);
  })();
}

interface Maker {
  portfolio(name: string, o?: { branch?: number; active?: boolean }): number;
  state(p: number, uf: number): void;
  city(p: number, m: { code: number; st: number }): void;
  hood(p: number, m: { code: number; st: number }, label: string): void;
  network(p: number, id: number): void;
  group(p: number, id: number): void;
  override(p: number, c: number, kind: 'include' | 'exclude'): void;
}

function maker(): Maker {
  const db = sq();
  const insP = db.prepare(
    `insert into portfolios (branch_id, name, name_key, responsible_sub, portfolio_type_id, status, active,
      created_at, updated_at, created_by, updated_by) values (?,?,?,?,?,'draft',?,?,?,'t','t')`,
  );
  const insR = db.prepare(
    `insert into portfolio_regions (portfolio_id, level, state_code, municipality_code, neighborhood_key, neighborhood_label)
     values (?,?,?,?,?,?)`,
  );
  return {
    portfolio: (name, o = {}) =>
      insP.run(
        o.branch ?? ser,
        name,
        name.toUpperCase(),
        'resp',
        typeId,
        o.active === false ? 0 : 1,
        NOW,
        NOW,
      ).lastInsertRowid as number,
    state: (p, uf) => void insR.run(p, 'state', uf, null, null, null),
    city: (p, m) => void insR.run(p, 'municipality', m.st, m.code, null, null),
    hood: (p, m, label) => void insR.run(p, 'neighborhood', m.st, m.code, neighborhoodKey(label), label),
    network: (p, id) => void db.prepare('insert into portfolio_retail_networks values (?,?)').run(p, id),
    group: (p, id) => void db.prepare('insert into portfolio_economic_groups values (?,?)').run(p, id),
    override: (p, c, kind) =>
      void db
        .prepare('insert or ignore into portfolio_customer_overrides values (?,?,?,?,?)')
        .run(p, c, kind, NOW, 't'),
  };
}

const muni = (i: number) => munis[i % munis.length] as { code: number; st: number };

/**
 * `count` carteiras ativas na filial `ser` (mais uma inativa e algumas na OUTRA filial, que não
 * concorrem), com filtros sobrepostos: cerca de 30% levam UF=ES (puro ou combinado com rede ou grupo).
 * Devolve a carteira ampla (UF ES+SP + 2 cidades), a mais cara, usada nas medições.
 */
function seedPortfolios(count: number): { broad: number; all: number[] } {
  const mk = maker();
  const all: number[] = [];
  const add = (name: string, setup: (p: number) => void) => {
    const p = mk.portfolio(name);
    setup(p);
    all.push(p);
    return p;
  };
  // Cerca de um terço das carteiras de filtro tem alguns ajustes manuais (inclusões e exclusões).
  const withAdjustments = (p: number, i: number) => {
    if (i % 3 !== 0) return;
    for (let c = 1; c <= 20; c++) {
      mk.override(p, c * 17 + (i % 7), 'include');
      mk.override(p, c * 19 + (i % 7), 'exclude');
    }
  };
  const broad = add('Ampla UF ES+SP', (p) => {
    mk.state(p, ES);
    mk.state(p, SP);
    mk.city(p, muni(12));
    mk.city(p, muni(13));
  });
  add('Cidades dup', (p) => {
    mk.city(p, muni(12));
    mk.city(p, muni(13));
  });
  for (let k = 0; all.length < count; k++) {
    const i = all.length;
    switch (k % 10) {
      case 0:
        add(`UF ES ${i}`, (p) => {
          mk.state(p, ES);
          withAdjustments(p, i);
        });
        break;
      case 1:
        add(`UF ES + rede ${i}`, (p) => {
          mk.state(p, ES);
          mk.network(p, nets[i % nets.length] as number);
        });
        break;
      case 2:
        add(`UF ES + grupo ${i}`, (p) => {
          mk.state(p, ES);
          mk.group(p, grps[i % grps.length] as number);
        });
        break;
      case 3:
        add(`Cidades ${i}`, (p) => {
          [0, 1, 2].forEach((j) => mk.city(p, muni(i + j * 3)));
          withAdjustments(p, i);
        });
        break;
      case 4:
        add(`Bairros ${i}`, (p) => [0, 1, 2].forEach((j) => mk.hood(p, muni(i), `Bairro ${(i + j) % 12}`)));
        break;
      case 5:
        add(`Rede ${i}`, (p) => mk.network(p, nets[i % nets.length] as number));
        break;
      case 6:
        add(`Grupo ${i}`, (p) => mk.group(p, grps[i % grps.length] as number));
        break;
      case 7:
        add(`Cidade + rede ${i}`, (p) => {
          mk.city(p, muni(i));
          mk.network(p, nets[i % nets.length] as number);
        });
        break;
      case 8:
        add(`Manual ${i}`, (p) => {
          for (let c = 1; c <= 300; c++) mk.override(p, c * 11 + (i % 5), 'include');
          for (let c = 1; c <= 50; c++) mk.override(p, c * 13 + (i % 5), 'exclude');
        });
        break;
      default:
        add(`UF ES bis ${i}`, (p) => {
          mk.state(p, ES);
          mk.city(p, muni(i));
        });
    }
  }
  const inactive = mk.portfolio('Inativa', { active: false });
  mk.state(inactive, ES);
  // Carteiras da outra filial na mesma UF: não concorrem com a filial.
  for (let k = 0; k < 5; k++) mk.state(mk.portfolio(`Outra ${k}`, { branch: car }), ES);
  return { broad, all };
}

interface Reference {
  /** Ids de P com posto (membros), em ordem. */
  members: number[];
  assigned: number[];
  blocked: number[];
  lost: number[];
}

/** Resolução de P calculada em JS a partir das tabelas, independente da SQL do motor. */
function reference(portfolioId: number): Reference {
  const db = sq();
  const custs = db
    .prepare(
      `select c.id as id, c.state_code as s, c.municipality_code as m, c.neighborhood_key as h,
        c.retail_network_id as n, c.economic_group_id as g
       from customers c join customer_branches cb on cb.customer_id = c.id
       where c.active = 1 and cb.branch_id = ? and cb.active = 1 order by c.id`,
    )
    .all(ser) as { id: number; s: number; m: number; h: string; n: number | null; g: number | null }[];
  const rivals = (
    db
      .prepare('select id from portfolios where branch_id = ? and active = 1 and id <> ?')
      .all(ser, portfolioId) as {
      id: number;
    }[]
  ).map((r) => r.id);
  interface Crit {
    regions: { level: string; s: number; m: number | null; h: string | null }[];
    nets: Set<number>;
    grps: Set<number>;
    ov: Map<number, string>;
  }
  const crit = new Map<number, Crit>();
  const of = (p: number): Crit => {
    let c = crit.get(p);
    if (!c) {
      c = { regions: [], nets: new Set(), grps: new Set(), ov: new Map() };
      crit.set(p, c);
    }
    return c;
  };
  for (const r of db
    .prepare(
      'select portfolio_id as p, level, state_code as s, municipality_code as m, neighborhood_key as h from portfolio_regions',
    )
    .all() as { p: number; level: string; s: number; m: number | null; h: string | null }[])
    of(r.p).regions.push(r);
  for (const r of db
    .prepare('select portfolio_id as p, retail_network_id as x from portfolio_retail_networks')
    .all() as {
    p: number;
    x: number;
  }[])
    of(r.p).nets.add(r.x);
  for (const r of db
    .prepare('select portfolio_id as p, economic_group_id as x from portfolio_economic_groups')
    .all() as {
    p: number;
    x: number;
  }[])
    of(r.p).grps.add(r.x);
  for (const r of db
    .prepare('select portfolio_id as p, customer_id as c, kind from portfolio_customer_overrides')
    .all() as {
    p: number;
    c: number;
    kind: string;
  }[])
    of(r.p).ov.set(r.c, r.kind);

  const rank = (p: number, c: (typeof custs)[number]): number | undefined => {
    const k = of(p);
    const ov = k.ov.get(c.id);
    if (ov === 'include') return 6;
    if (ov === 'exclude') return undefined;
    if (k.regions.length + k.nets.size + k.grps.size === 0) return undefined;
    let region = 0;
    for (const r of k.regions) {
      if (r.level === 'state' && r.s === c.s) region = Math.max(region, 1);
      else if (r.level === 'municipality' && r.m === c.m) region = Math.max(region, 2);
      else if (r.level === 'neighborhood' && r.m === c.m && r.h === c.h) region = Math.max(region, 3);
    }
    const byNet = c.n !== null && k.nets.has(c.n);
    const byGrp = c.g !== null && k.grps.has(c.g);
    if (k.regions.length > 0 && region === 0) return undefined;
    if (k.nets.size > 0 && !byNet) return undefined;
    if (k.grps.size > 0 && !byGrp) return undefined;
    return Math.max(byGrp ? 5 : 0, byNet ? 4 : 0, region);
  };

  const out: Reference = { members: [], assigned: [], blocked: [], lost: [] };
  for (const c of custs) {
    const mine = rank(portfolioId, c);
    if (mine === undefined) continue;
    out.members.push(c.id);
    let best = -1;
    for (const q of rivals) {
      const r = rank(q, c);
      if (r !== undefined && r > best) best = r;
    }
    if (best < mine) out.assigned.push(c.id);
    else if (best === mine) out.blocked.push(c.id);
    else out.lost.push(c.id);
  }
  return out;
}

const dialect = new SQLiteSyncDialect();
function explain(q: SQL): string {
  const { sql: text, params } = dialect.sqlToQuery(q);
  return (
    sq()
      .prepare(`explain query plan ${text}`)
      .all(...params) as { detail: string }[]
  )
    .map((r) => '    ' + r.detail)
    .join('\n');
}

function time<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const r = fn();
  return [r, performance.now() - t0];
}

/** Mede e confere uma carteira `P` contra a referência independente. */
function measure(label: string, portfolioId: number, ceilings: Ceilings): void {
  const ref = reference(portfolioId);
  const criteria = loadPortfolioCriteria(fx.db, portfolioId);
  // Página 50 (limit 50) da lista correspondente; se a lista for menor, a última página cheia.
  const startOf = (ids: number[]) => Math.max(0, Math.min(49 * 50, ids.length - 50));
  const slice = (ids: number[]) => ids.slice(startOf(ids), startOf(ids) + 50);
  const page = (resolution?: Resolution, ids: number[] = ref.members) => {
    const start = startOf(ids);
    return previewPage(fx.db, criteria, {
      portfolioId,
      limit: 50,
      ...(start > 0 ? { cursor: encodeCursor(ids[start - 1] as number) } : {}),
      ...(resolution ? { resolution } : {}),
    });
  };

  const [plain, tPlain] = time(() => page());
  const [blocked, tBlocked] = time(() => page('blocked', ref.blocked));
  const [lost, tLost] = time(() => page('lost', ref.lost));
  const [assigned, tAssigned] = time(() => page('assigned', ref.assigned));
  const svc = createPortfolioService(fx.db);
  const admin = adminOf('SER');
  const [plainAgg, tAgg] = time(() => svc.get(admin, portfolioId));
  const [agg, tCounts] = time(() => svc.get(admin, portfolioId, 'conflicts'));
  const [eff, tEff] = time(() => [...effectiveMembers(fx.db, portfolioId)].map((m) => m.customerId));

  console.log(
    `[volume ${label}] membros=${ref.members.length} assigned=${ref.assigned.length} blocked=${ref.blocked.length} lost=${ref.lost.length}\n` +
      `  pagina50 sem resolution=${tPlain.toFixed(0)}ms | blocked=${tBlocked.toFixed(0)}ms | lost=${tLost.toFixed(0)}ms | assigned=${tAssigned.toFixed(0)}ms\n` +
      `  GET agregado=${tAgg.toFixed(0)}ms | GET ?include=conflicts=${tCounts.toFixed(0)}ms | effectiveMembers=${tEff.toFixed(0)}ms`,
  );

  // Contra a referência independente (JS puro sobre as tabelas).
  expect(plain.total).toBe(ref.members.length);
  expect(plain.items.map((i) => i.customerId)).toEqual(slice(ref.members));
  expect(blocked.total).toBe(ref.blocked.length);
  expect(lost.total).toBe(ref.lost.length);
  expect(assigned.total).toBe(ref.assigned.length);
  expect(blocked.items.map((i) => i.customerId)).toEqual(slice(ref.blocked));
  expect(lost.items.map((i) => i.customerId)).toEqual(slice(ref.lost));
  const blockedSet = new Set(ref.blocked);
  const lostSet = new Set(ref.lost);
  expect(plain.items.length).toBe(Math.min(50, ref.members.length));
  for (const it of plain.items) {
    const want = blockedSet.has(it.customerId) ? 'blocked' : lostSet.has(it.customerId) ? 'lost' : 'assigned';
    expect(it.resolution).toBe(want);
  }
  expect(plainAgg.conflictsBlocked).toBeUndefined();
  expect(agg.conflictsBlocked).toBe(ref.blocked.length);
  expect(agg.conflictsLost).toBe(ref.lost.length);
  expect(eff).toEqual(ref.assigned);

  if (!ASSERT_TIMING) return;
  for (const t of [tPlain, tAgg]) expect(t).toBeLessThan(ceilings.cheap);
  for (const t of [tBlocked, tLost, tAssigned, tCounts, tEff]) expect(t).toBeLessThan(ceilings.resolve);
}

function report(label: string, portfolioId: number): void {
  const criteria = loadPortfolioCriteria(fx.db, portfolioId);
  console.log(
    `[volume ${label}] EXPLAIN ids da prévia:\n${explain(previewIdsSql(criteria, { portfolioId }))}`,
  );
  console.log(`[volume ${label}] EXPLAIN contagens:\n${explain(conflictCountsSql(criteria, portfolioId))}`);
}

describe('conflitos: volume (pior caso realista)', () => {
  it('(i) 50 mil clientes na filial + 200 mil de outra filial na mesma UF, 20 carteiras sobrepostas', () => {
    seedCustomers(50_000, 200_000);
    const { broad, all } = seedPortfolios(20);
    expect(all).toHaveLength(20);
    report('50k+200k/20', broad);
    const limits = { cheap: CEILING_MS, resolve: CEILING_MS };
    measure('50k+200k/20 ampla', broad, limits);
    // Uma carteira só de UF e uma manual da mesma disputa.
    measure('50k+200k/20 UF ES', all[2] as number, limits);
    measure('50k+200k/20 manual', all[10] as number, limits);
  }, 300_000);

  it('(ii) 50 mil clientes e 100 carteiras sobrepostas na filial', () => {
    seedCustomers(50_000, 0);
    const { broad, all } = seedPortfolios(100);
    expect(all).toHaveLength(100);
    report('50k/100', broad);
    // ACIMA DO TETO DE 1,5 s, ACEITO PELO MAESTRO como risco registrado (2026-10-08): com 100 carteiras
    // sobrepostas, as operações que resolvem a disputa levam cerca de 2,3 a 2,6 s, com picos de 4,6 a
    // 5,3 s medidos. O teto abaixo é guarda de regressão (o código anterior à otimização levava ~8 s),
    // não a meta. Fechar a diferença exige cache por filial (melhoria futura). Sem disputa: 1,5 s.
    const limits = { cheap: CEILING_MS, resolve: 7000 };
    measure('50k/100 ampla', broad, limits);
    measure('50k/100 UF ES', all[2] as number, limits);
    measure('50k/100 manual', all[10] as number, limits);
  }, 300_000);
});
