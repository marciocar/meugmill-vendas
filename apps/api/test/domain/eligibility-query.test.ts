import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadPortfolioCriteria,
  previewCountSql,
  previewPage,
  previewPageSql,
  type PreviewPage,
  type PreviewSource,
} from '../../src/domain/eligibility/query.js';
import { neighborhoodKey, searchKey } from '../../src/domain/shared/normalize.js';
import {
  CNPJ_A,
  CNPJ_B,
  ES,
  SAO_PAULO,
  SERRA,
  SP,
  VITORIA,
  makeFixture,
  seedBranch,
  seedEconomicGroup,
  seedRetailNetwork,
  type Fixture,
} from '../helpers/seed.js';

const NOW = 1_700_000_000_000;

let fx: Fixture;
let ser: number;
let car: number;
let portfolioId: number;
let typeId: number;
let seq = 0;

interface CustomerOpts {
  name?: string;
  trade?: string | null;
  cnpj?: string;
  municipality?: number;
  state?: number;
  neighborhood?: string;
  network?: number | null;
  group?: number | null;
  active?: boolean;
  branches?: { id: number; active?: boolean }[];
}

/** Cliente direto no banco (fixture). Por padrão: ativo, em Serra/Centro, vinculado à filial SER. */
function customer(o: CustomerOpts = {}): number {
  seq += 1;
  const name = o.name ?? `Cliente ${seq}`;
  const hood = o.neighborhood ?? 'Centro';
  const id = fx.app.sqlite
    .prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, trade_name, trade_name_key, state_code,
        municipality_code, neighborhood, neighborhood_key, retail_network_id, economic_group_id, active,
        created_at, updated_at, created_by, updated_by) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      o.cnpj ?? String(seq).padStart(14, '0'),
      name,
      searchKey(name),
      o.trade ?? null,
      o.trade ? searchKey(o.trade) : null,
      o.state ?? ES,
      o.municipality ?? SERRA,
      hood,
      neighborhoodKey(hood),
      o.network ?? null,
      o.group ?? null,
      o.active === false ? 0 : 1,
      NOW,
      NOW,
      't',
      't',
    ).lastInsertRowid as number;
  for (const b of o.branches ?? [{ id: ser }]) {
    fx.app.sqlite
      .prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,?)')
      .run(id, b.id, b.active === false ? 0 : 1);
  }
  return id;
}

function newPortfolio(branchId = ser, name = `Carteira ${++seq}`): number {
  return fx.app.sqlite
    .prepare(
      `insert into portfolios (branch_id, name, name_key, responsible_sub, portfolio_type_id, created_at,
        updated_at, created_by, updated_by) values (?,?,?,?,?,?,?,?,?)`,
    )
    .run(branchId, name, searchKey(name), 'resp', typeId, NOW, NOW, 't', 't').lastInsertRowid as number;
}

const state = (uf: number, pid = portfolioId) =>
  fx.app.sqlite
    .prepare(`insert into portfolio_regions (portfolio_id, level, state_code) values (?,?,?)`)
    .run(pid, 'state', uf);
const city = (m: number, uf: number, pid = portfolioId) =>
  fx.app.sqlite
    .prepare(
      `insert into portfolio_regions (portfolio_id, level, state_code, municipality_code) values (?,?,?,?)`,
    )
    .run(pid, 'municipality', uf, m);
const hood = (m: number, uf: number, label: string, pid = portfolioId) =>
  fx.app.sqlite
    .prepare(
      `insert into portfolio_regions (portfolio_id, level, state_code, municipality_code, neighborhood_key, neighborhood_label)
       values (?,?,?,?,?,?)`,
    )
    .run(pid, 'neighborhood', uf, m, neighborhoodKey(label), label);
const network = (id: number, pid = portfolioId) =>
  fx.app.sqlite.prepare('insert into portfolio_retail_networks values (?,?)').run(pid, id);
const group = (id: number, pid = portfolioId) =>
  fx.app.sqlite.prepare('insert into portfolio_economic_groups values (?,?)').run(pid, id);
const override = (customerId: number, kind: 'include' | 'exclude', pid = portfolioId) =>
  fx.app.sqlite
    .prepare('insert into portfolio_customer_overrides values (?,?,?,?,?)')
    .run(pid, customerId, kind, NOW, 't');

function preview(
  extra: { cursor?: string; limit?: number; q?: string; source?: PreviewSource } = {},
  pid = portfolioId,
): PreviewPage {
  return previewPage(fx.db, loadPortfolioCriteria(fx.db, pid), { portfolioId: pid, ...extra });
}
const ids = (p: PreviewPage) => p.items.map((i) => i.customerId);

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
  portfolioId = newPortfolio();
});
afterEach(async () => {
  await fx.app.close();
});

describe('motor de elegibilidade: critérios', () => {
  it('carrega os critérios atuais da carteira', () => {
    expect(loadPortfolioCriteria(fx.db, portfolioId)).toMatchObject({
      branchId: ser,
      hasAnyCriterion: false,
    });
    state(ES);
    city(SERRA, ES);
    const n = seedRetailNetwork(fx.db, 'R1');
    network(n);
    const c = loadPortfolioCriteria(fx.db, portfolioId);
    expect(c.hasAnyCriterion).toBe(true);
    expect(c.regions).toEqual([
      { level: 'state', stateCode: ES },
      { level: 'municipality', stateCode: ES, municipalityCode: SERRA },
    ]);
    expect(c.retailNetworkIds).toEqual([n]);
  });

  it('OU dentro do critério: duas UFs', () => {
    const es = customer({ state: ES, municipality: SERRA });
    const sp = customer({ state: SP, municipality: SAO_PAULO });
    state(ES);
    state(SP);
    expect(ids(preview())).toEqual([es, sp]);
  });

  it('E entre critérios: região + rede, quem casa só um fica fora', () => {
    const r1 = seedRetailNetwork(fx.db, 'R1');
    const both = customer({ network: r1 });
    customer({ network: null });
    customer({ network: r1, state: SP, municipality: SAO_PAULO });
    state(ES);
    network(r1);
    const p = preview();
    expect(ids(p)).toEqual([both]);
    expect(p.items[0]?.matchedBy).toEqual({ region: true, retailNetwork: true, economicGroup: false });
  });

  it('só rede e grupo (sem região): matchedRegionLevel nulo', () => {
    const r1 = seedRetailNetwork(fx.db, 'R1');
    const g1 = seedEconomicGroup(fx.db, 'G1');
    const ok = customer({ network: r1, group: g1 });
    customer({ network: r1 });
    network(r1);
    group(g1);
    const p = preview();
    expect(p.items).toEqual([
      {
        customerId: ok,
        source: 'filter',
        matchedRegionLevel: null,
        matchedBy: { region: false, retailNetwork: true, economicGroup: true },
      },
    ]);
  });

  it('nível mais específico: UF, município e bairro casam juntos -> neighborhood', () => {
    const c = customer({ neighborhood: 'Jardim Câmburi', municipality: VITORIA });
    state(ES);
    city(VITORIA, ES);
    hood(VITORIA, ES, 'jardim camburi');
    expect(preview().items[0]).toMatchObject({ customerId: c, matchedRegionLevel: 'neighborhood' });
  });

  it('níveis isolados: state e municipality', () => {
    const a = customer({ municipality: SERRA });
    const b = customer({ municipality: VITORIA });
    state(ES, portfolioId);
    const p2 = newPortfolio(ser, 'Outra');
    city(VITORIA, ES, p2);
    expect(preview().items.map((i) => [i.customerId, i.matchedRegionLevel])).toEqual([
      [a, 'state'],
      [b, 'state'],
    ]);
    expect(preview({}, p2).items.map((i) => [i.customerId, i.matchedRegionLevel])).toEqual([
      [b, 'municipality'],
    ]);
  });

  it('município de outra UF não casa (cliente de SP não casa a UF ES)', () => {
    customer({ state: SP, municipality: SAO_PAULO });
    state(ES);
    expect(preview().total).toBe(0);
  });

  it('bairro com o mesmo nome em outro município não casa', () => {
    const serra = customer({ municipality: SERRA, neighborhood: 'Centro' });
    customer({ municipality: VITORIA, neighborhood: 'Centro' });
    hood(SERRA, ES, 'Centro');
    expect(ids(preview())).toEqual([serra]);
  });

  it('cliente inativo, vínculo inativo e outra filial ficam fora', () => {
    const ok = customer();
    customer({ active: false });
    customer({ branches: [{ id: ser, active: false }] });
    customer({ branches: [{ id: car }] });
    const both = customer({ branches: [{ id: ser }, { id: car }] });
    state(ES);
    expect(ids(preview())).toEqual([ok, both]);
  });

  it('carteira sem critério: nenhum candidato por filtro, só inclusões', () => {
    const a = customer();
    customer();
    expect(preview()).toEqual({ items: [], nextCursor: null, total: 0 });
    override(a, 'include');
    const p = preview();
    expect(p.items).toEqual([
      {
        customerId: a,
        source: 'manual',
        matchedRegionLevel: null,
        matchedBy: { region: false, retailNetwork: false, economicGroup: false },
      },
    ]);
    expect(p.total).toBe(1);
  });
});

describe('motor de elegibilidade: ajustes manuais', () => {
  it('exclusão remove o candidato; exclusão de quem não casa não tem efeito', () => {
    const a = customer();
    const b = customer();
    const out = customer({ state: SP, municipality: SAO_PAULO });
    state(ES);
    override(a, 'exclude');
    override(out, 'exclude');
    const p = preview();
    expect(ids(p)).toEqual([b]);
    expect(p.total).toBe(1);
  });

  it('inclusão de quem não casa entra como manual; de quem casa fica filter', () => {
    const r1 = seedRetailNetwork(fx.db, 'R1');
    const matches = customer({ network: r1 });
    const partial = customer({ network: null }); // casa a região, não a rede
    const far = customer({ state: SP, municipality: SAO_PAULO, network: r1 }); // casa a rede, não a região
    state(ES);
    network(r1);
    override(matches, 'include');
    override(partial, 'include');
    override(far, 'include');
    const p = preview();
    expect(p.items.map((i) => [i.customerId, i.source])).toEqual([
      [matches, 'filter'],
      [partial, 'manual'],
      [far, 'manual'],
    ]);
    expect(p.items[1]?.matchedBy).toEqual({ region: true, retailNetwork: false, economicGroup: false });
    // inclusão manual não carrega nível de região, mesmo quando a região casou
    expect(p.items[0]?.matchedRegionLevel).toBe('state');
    expect(p.items[1]?.matchedRegionLevel).toBeNull();
    expect(p.items[2]?.matchedBy).toEqual({ region: false, retailNetwork: true, economicGroup: false });
    expect(p.items[2]?.matchedRegionLevel).toBeNull();
  });

  it('inclusão inválida (inativo, sem vínculo ativo, outra filial) não aparece', () => {
    const inactive = customer({ active: false });
    const unlinked = customer({ branches: [{ id: ser, active: false }] });
    const other = customer({ branches: [{ id: car }] });
    state(SP);
    for (const id of [inactive, unlinked, other]) override(id, 'include');
    expect(preview()).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('ajustes de outra carteira não interferem', () => {
    const a = customer();
    const other = newPortfolio(ser, 'Outra');
    state(ES);
    override(a, 'exclude', other);
    expect(ids(preview())).toEqual([a]);
  });
});

describe('motor de elegibilidade: combinações de critérios', () => {
  it('região + rede + grupo juntos: só quem casa os três entra, com matchedBy correto', () => {
    const r1 = seedRetailNetwork(fx.db, 'R1');
    const g1 = seedEconomicGroup(fx.db, 'G1');
    const all3 = customer({ network: r1, group: g1 });
    customer({ network: r1, group: null });
    customer({ network: null, group: g1 });
    customer({ network: r1, group: g1, state: SP, municipality: SAO_PAULO });
    customer({ network: null, group: null });
    state(ES);
    network(r1);
    group(g1);
    const p = preview();
    expect(p.total).toBe(1);
    expect(p.items).toEqual([
      {
        customerId: all3,
        source: 'filter',
        matchedRegionLevel: 'state',
        matchedBy: { region: true, retailNetwork: true, economicGroup: true },
      },
    ]);
  });

  it('região mista: cada cliente recebe o nível mais específico que casou', () => {
    state(ES);
    city(SERRA, ES);
    hood(VITORIA, ES, 'Praia do Canto');
    const onlyState = customer({ municipality: 3201308 }); // outro município do ES
    const city1 = customer({ municipality: SERRA, neighborhood: 'Laranjeiras' });
    const hood1 = customer({ municipality: VITORIA, neighborhood: 'Praia do Canto' });
    const hood2 = customer({ municipality: VITORIA, neighborhood: 'Centro' }); // só a UF
    const p = preview();
    expect(p.items.map((i) => [i.customerId, i.matchedRegionLevel])).toEqual([
      [onlyState, 'state'],
      [city1, 'municipality'],
      [hood1, 'neighborhood'],
      [hood2, 'state'],
    ]);
  });
});

describe('motor de elegibilidade: busca, source e paginação', () => {
  it('q por nome (sem acento/caixa), fantasia, CNPJ e escape de % e _', () => {
    const a = customer({ name: 'Farmácia São João', cnpj: CNPJ_A });
    const b = customer({ name: 'Drogaria Alfa', trade: 'Popular 100%', cnpj: CNPJ_B });
    const c = customer({ name: 'Drogaria Beta' });
    state(ES);
    expect(ids(preview({ q: 'farmacia sao' }))).toEqual([a]);
    expect(ids(preview({ q: 'POPULAR' }))).toEqual([b]);
    expect(ids(preview({ q: '11.444.777' }))).toEqual([b]);
    expect(ids(preview({ q: '100%' }))).toEqual([b]);
    expect(ids(preview({ q: '%' }))).toEqual([b]);
    expect(ids(preview({ q: 'drogaria _lfa' }))).toEqual([]);
    expect(preview({ q: 'drogaria' }).total).toBe(2);
    expect(ids(preview({ q: 'drogaria' }))).toEqual([b, c]);
  });

  it('source filtra filter/manual e o total acompanha', () => {
    const f1 = customer();
    const f2 = customer();
    const m1 = customer({ state: SP, municipality: SAO_PAULO });
    state(ES);
    override(m1, 'include');
    expect(ids(preview({ source: 'filter' }))).toEqual([f1, f2]);
    expect(preview({ source: 'filter' }).total).toBe(2);
    expect(ids(preview({ source: 'manual' }))).toEqual([m1]);
    expect(preview({ source: 'manual' }).total).toBe(1);
    expect(preview().total).toBe(3);
  });

  it('pagina por cursor em ordem de id e o total ignora cursor/limit', () => {
    const all = Array.from({ length: 5 }, () => customer());
    state(ES);
    const p1 = preview({ limit: 2 });
    expect(ids(p1)).toEqual(all.slice(0, 2));
    expect(p1.total).toBe(5);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = preview({ limit: 2, cursor: p1.nextCursor as string });
    expect(ids(p2)).toEqual(all.slice(2, 4));
    const p3 = preview({ limit: 2, cursor: p2.nextCursor as string });
    expect(ids(p3)).toEqual(all.slice(4));
    expect(p3.nextCursor).toBeNull();
    expect(p3.total).toBe(5);
  });

  it('rejeita limit fora de 1..200 e cursor inválido; carteira inexistente é not_found', () => {
    state(ES);
    expect(() => preview({ limit: 0 })).toThrow();
    expect(() => preview({ limit: 201 })).toThrow();
    expect(() => preview({ cursor: '!!' })).toThrow();
    expect(() => loadPortfolioCriteria(fx.db, 9999)).toThrow();
  });

  it('valores nunca são interpolados: q malicioso é só dado', () => {
    customer();
    state(ES);
    expect(preview({ q: "'; drop table customers; --" }).total).toBe(0);
    expect(preview().total).toBe(1);
  });
});

describe('motor de elegibilidade: volume sintético (50 mil clientes)', () => {
  it('prévia com 50k clientes: tempos e plano', () => {
    const sqlite = fx.app.sqlite;
    const br3 = seedBranch(fx.db, 'ABC');
    const branchIds = [ser, car, br3];
    const munis = sqlite
      .prepare(
        'select ibge_code as code, state_code as st from municipalities where state_code in (32, 35) order by ibge_code limit 30',
      )
      .all() as { code: number; st: number }[];
    const networks = Array.from({ length: 8 }, (_, i) => seedRetailNetwork(fx.db, `VR${i}`));
    const groups = Array.from({ length: 5 }, (_, i) => seedEconomicGroup(fx.db, `VG${i}`));
    const N = 50_000;
    const insC = sqlite.prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
        neighborhood_key, retail_network_id, economic_group_id, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,?,?,?,?,?,?,'t','t')`,
    );
    const insL = sqlite.prepare(
      'insert into customer_branches (customer_id, branch_id, active) values (?,?,?)',
    );
    sqlite.transaction(() => {
      for (let i = 0; i < N; i++) {
        const m = munis[i % munis.length] as { code: number; st: number };
        const b = `Bairro ${i % 12}`;
        const id = insC.run(
          String(i + 1).padStart(14, '0'),
          `Cliente ${i}`,
          `CLIENTE ${i}`,
          m.st,
          m.code,
          b,
          neighborhoodKey(b),
          i % 3 === 0 ? (networks[i % networks.length] as number) : null,
          i % 4 === 0 ? (groups[i % groups.length] as number) : null,
          i % 50 === 0 ? 0 : 1,
          NOW,
          NOW,
        ).lastInsertRowid as number;
        insL.run(id, branchIds[i % 3] as number, i % 40 === 0 ? 0 : 1);
        if (i % 7 === 0) insL.run(id, branchIds[(i + 1) % 3] as number, 1);
      }
    })();
    const pid = newPortfolio(ser, 'Volume');
    state(ES, pid);
    state(SP, pid);
    for (const m of munis.slice(0, 5)) city(m.code, m.st, pid);
    for (let i = 0; i < 10; i++) {
      const m = munis[i] as { code: number; st: number };
      hood(m.code, m.st, `Bairro ${i}`, pid);
    }
    for (const n of networks.slice(0, 3)) network(n, pid);
    for (let i = 0; i < 20; i++) override(i * 7 + 1, i % 2 ? 'include' : 'exclude', pid);

    const criteria = loadPortfolioCriteria(fx.db, pid);
    const time = <T>(fn: () => T): [T, number] => {
      const t0 = performance.now();
      const r = fn();
      return [r, performance.now() - t0];
    };
    const [first, t1] = time(() => previewPage(fx.db, criteria, { portfolioId: pid, limit: 50 }));
    expect(first.items).toHaveLength(50);
    expect(first.total).toBeGreaterThan(100);
    const mid = Buffer.from('25000', 'utf8').toString('base64url');
    const [middle, t2] = time(() =>
      previewPage(fx.db, criteria, { portfolioId: pid, limit: 50, cursor: mid }),
    );
    expect(middle.items.length).toBe(50);
    expect(middle.items[0]?.customerId).toBeGreaterThan(25_000);
    const [filtered, t3] = time(() =>
      previewPage(fx.db, criteria, { portfolioId: pid, limit: 50, q: 'cliente 4', source: 'filter' }),
    );
    expect(filtered.total).toBeGreaterThan(0);

    const dialect = new SQLiteSyncDialect();
    const explain = (q: ReturnType<typeof previewPageSql>) => {
      const { sql: text, params } = dialect.sqlToQuery(q);
      return sqlite.prepare(`explain query plan ${text}`).all(...params) as { detail: string }[];
    };
    const plan = explain(previewPageSql(criteria, { portfolioId: pid, fetch: 51 }));
    const planCount = explain(previewCountSql(criteria, { portfolioId: pid }));
    console.log(
      `[volume 50k] total=${first.total} primeira pagina(+total)=${t1.toFixed(0)}ms meio(+total)=${t2.toFixed(0)}ms q+source=${t3.toFixed(0)}ms`,
    );
    console.log(`[volume 50k] EXPLAIN pagina:\n${plan.map((r) => '  ' + r.detail).join('\n')}`);
    console.log(`[volume 50k] EXPLAIN count:\n${planCount.map((r) => '  ' + r.detail).join('\n')}`);
    expect(t1).toBeLessThan(1500);
    expect(t2).toBeLessThan(1500);
    expect(t3).toBeLessThan(1500);
  }, 30_000);
});
