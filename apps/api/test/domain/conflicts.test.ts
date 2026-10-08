import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectiveMembers } from '../../src/domain/conflicts/members.js';
import {
  conflictCountsSql,
  loadPortfolioCriteria,
  previewIdsSql,
  previewPage,
  type ResolvedPage,
  type Resolution,
} from '../../src/domain/eligibility/query.js';
import { createEligibilityService } from '../../src/domain/eligibility/service.js';
import { createPortfolioTypeService } from '../../src/domain/portfolio-types/service.js';
import { createPortfolioService } from '../../src/domain/portfolios/service.js';
import { loadAggregate } from '../../src/domain/portfolios/aggregate.js';
import { neighborhoodKey, searchKey } from '../../src/domain/shared/normalize.js';
import {
  ES,
  SERRA,
  SP,
  VITORIA,
  adminOf,
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
let typeId: number;
let seq = 0;
let net: number;
let grp: number;

function customer(
  o: {
    municipality?: number;
    state?: number;
    neighborhood?: string;
    network?: number | null;
    group?: number | null;
    active?: boolean;
    branches?: number[];
  } = {},
): number {
  seq += 1;
  const name = `Cliente ${seq}`;
  const hood = o.neighborhood ?? 'Centro';
  const id = fx.app.sqlite
    .prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
        neighborhood_key, retail_network_id, economic_group_id, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      String(seq).padStart(14, '0'),
      name,
      searchKey(name),
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
  for (const b of o.branches ?? [ser]) {
    fx.app.sqlite
      .prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,1)')
      .run(id, b);
  }
  return id;
}

function newPortfolio(
  name: string,
  o: { branch?: number; active?: boolean; status?: 'draft' | 'active' } = {},
) {
  return fx.app.sqlite
    .prepare(
      `insert into portfolios (branch_id, name, name_key, responsible_sub, portfolio_type_id, status, active,
        created_at, updated_at, created_by, updated_by) values (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      o.branch ?? ser,
      name,
      searchKey(name),
      'resp',
      typeId,
      o.status ?? 'draft',
      o.active === false ? 0 : 1,
      NOW,
      NOW,
      't',
      't',
    ).lastInsertRowid as number;
}

const sqlite = () => fx.app.sqlite;
const stateOf = (p: number, uf: number) =>
  sqlite()
    .prepare('insert into portfolio_regions (portfolio_id, level, state_code) values (?,?,?)')
    .run(p, 'state', uf);
const cityOf = (p: number, m: number, uf = ES) =>
  sqlite()
    .prepare(
      'insert into portfolio_regions (portfolio_id, level, state_code, municipality_code) values (?,?,?,?)',
    )
    .run(p, 'municipality', uf, m);
const hoodOf = (p: number, m: number, label: string, uf = ES) =>
  sqlite()
    .prepare(
      `insert into portfolio_regions (portfolio_id, level, state_code, municipality_code, neighborhood_key, neighborhood_label)
       values (?,?,?,?,?,?)`,
    )
    .run(p, 'neighborhood', uf, m, neighborhoodKey(label), label);
const networkOf = (p: number, id: number) =>
  sqlite().prepare('insert into portfolio_retail_networks values (?,?)').run(p, id);
const groupOf = (p: number, id: number) =>
  sqlite().prepare('insert into portfolio_economic_groups values (?,?)').run(p, id);
const override = (p: number, c: number, kind: 'include' | 'exclude') =>
  sqlite().prepare('insert into portfolio_customer_overrides values (?,?,?,?,?)').run(p, c, kind, NOW, 't');

function view(
  p: number,
  extra: { resolution?: Resolution; limit?: number; cursor?: string } = {},
): ResolvedPage {
  return previewPage(fx.db, loadPortfolioCriteria(fx.db, p), { portfolioId: p, ...extra });
}
/** Resolução e posto do cliente na prévia da carteira. */
function of(p: number, c: number) {
  const item = view(p, { limit: 200 }).items.find((i) => i.customerId === c);
  return item ? { resolution: item.resolution, rank: item.rank } : undefined;
}

beforeEach(async () => {
  fx = await makeFixture();
  ser = seedBranch(fx.db, 'SER');
  car = seedBranch(fx.db, 'CAR');
  typeId = sqlite()
    .prepare(
      `insert into portfolio_types (code, name, name_key, created_at, updated_at, created_by, updated_by)
      values ('T','Tipo','TIPO',?,?,'t','t')`,
    )
    .run(NOW, NOW).lastInsertRowid as number;
  net = seedRetailNetwork(fx.db, 'R1');
  grp = seedEconomicGroup(fx.db, 'G1');
});
afterEach(async () => {
  await fx.app.close();
});

describe('conflitos: posto de cada critério', () => {
  it('UF=1, município=2, bairro=3, rede=4, grupo econômico=5, manual=6', () => {
    const c = customer({ network: net, group: grp });
    const ranks: [string, (p: number) => void, number][] = [
      ['uf', (p) => stateOf(p, ES), 1],
      ['cidade', (p) => cityOf(p, SERRA), 2],
      ['bairro', (p) => hoodOf(p, SERRA, 'Centro'), 3],
      ['rede', (p) => networkOf(p, net), 4],
      ['grupo', (p) => groupOf(p, grp), 5],
    ];
    for (const [name, setup, rank] of ranks) {
      const p = newPortfolio(name);
      setup(p);
      expect(of(p, c)).toEqual({ resolution: 'assigned', rank });
    }
    const manual = newPortfolio('manual');
    override(manual, c, 'include');
    expect(of(manual, c)).toEqual({ resolution: 'assigned', rank: 6 });
  });

  it('grupo > rede > bairro > cidade > UF: o de maior posto vence, os demais perdem', () => {
    const c = customer({ network: net, group: grp });
    const order: number[] = [];
    const defs: ((p: number) => void)[] = [
      (p) => stateOf(p, ES),
      (p) => cityOf(p, SERRA),
      (p) => hoodOf(p, SERRA, 'Centro'),
      (p) => networkOf(p, net),
      (p) => groupOf(p, grp),
    ];
    for (const [i, setup] of defs.entries()) {
      const p = newPortfolio(`P${i}`);
      setup(p);
      order.push(p);
    }
    expect(order.map((p) => of(p, c)?.resolution)).toEqual(['lost', 'lost', 'lost', 'lost', 'assigned']);
  });

  it('carteira de região + rede vale pela rede (o maior entre os que casaram)', () => {
    const c = customer({ network: net });
    const mixed = newPortfolio('regiao+rede');
    hoodOf(mixed, SERRA, 'Centro');
    networkOf(mixed, net);
    expect(of(mixed, c)?.rank).toBe(4);
    const hoodOnly = newPortfolio('bairro');
    hoodOf(hoodOnly, SERRA, 'Centro');
    expect(of(hoodOnly, c)).toEqual({ resolution: 'lost', rank: 3 });
    expect(of(mixed, c)?.resolution).toBe('assigned');
  });

  it('manual (6) vence qualquer filtro, inclusive grupo econômico', () => {
    const c = customer({ group: grp });
    const filter = newPortfolio('grupo');
    groupOf(filter, grp);
    const manual = newPortfolio('manual');
    override(manual, c, 'include');
    expect(of(manual, c)).toEqual({ resolution: 'assigned', rank: 6 });
    expect(of(filter, c)).toEqual({ resolution: 'lost', rank: 5 });
  });

  it('inclusão manual de quem também casa o filtro vale 6', () => {
    const c = customer();
    const a = newPortfolio('A');
    stateOf(a, ES);
    override(a, c, 'include');
    expect(of(a, c)?.rank).toBe(6);
  });
});

describe('conflitos: resolução', () => {
  it('dois manuais empatam: bloqueado nas DUAS', () => {
    const c = customer();
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    override(a, c, 'include');
    override(b, c, 'include');
    expect(of(a, c)).toEqual({ resolution: 'blocked', rank: 6 });
    expect(of(b, c)).toEqual({ resolution: 'blocked', rank: 6 });
  });

  it('bairro vence cidade (exemplo do documento): vencedor assigned, perdedor lost', () => {
    const c = customer({ neighborhood: 'Laranjeiras' });
    const city = newPortfolio('Serra inteira');
    cityOf(city, SERRA);
    const hood = newPortfolio('Laranjeiras');
    hoodOf(hood, SERRA, 'Laranjeiras');
    expect(of(hood, c)).toEqual({ resolution: 'assigned', rank: 3 });
    expect(of(city, c)).toEqual({ resolution: 'lost', rank: 2 });
  });

  it('mesmo posto nas duas carteiras: blocked nas duas', () => {
    const c = customer();
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    cityOf(a, SERRA);
    cityOf(b, SERRA);
    expect(of(a, c)?.resolution).toBe('blocked');
    expect(of(b, c)?.resolution).toBe('blocked');
  });

  it('três carteiras: empate no topo bloqueia as duas, a terceira perde', () => {
    const c = customer();
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    const low = newPortfolio('UF');
    cityOf(a, SERRA);
    cityOf(b, SERRA);
    stateOf(low, ES);
    expect(of(a, c)?.resolution).toBe('blocked');
    expect(of(b, c)?.resolution).toBe('blocked');
    expect(of(low, c)?.resolution).toBe('lost');
  });

  it('exclusão tira o cliente da disputa: o outro passa a assigned', () => {
    const c = customer();
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    cityOf(a, SERRA);
    cityOf(b, SERRA);
    expect(of(b, c)?.resolution).toBe('blocked');
    override(a, c, 'exclude');
    expect(of(a, c)).toBeUndefined();
    expect(of(b, c)).toEqual({ resolution: 'assigned', rank: 2 });
    expect(view(b).items[0]?.competitors).toEqual([]);
  });

  it('carteira inativa não concorre; reativar volta a concorrer (sem cache)', () => {
    const c = customer();
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    hoodOf(a, SERRA, 'Centro');
    stateOf(b, ES);
    expect(of(b, c)?.resolution).toBe('lost');
    sqlite().prepare('update portfolios set active = 0 where id = ?').run(a);
    expect(of(b, c)).toEqual({ resolution: 'assigned', rank: 1 });
    expect(view(b).items[0]?.competitors).toEqual([]);
    sqlite().prepare('update portfolios set active = 1 where id = ?').run(a);
    expect(of(b, c)?.resolution).toBe('lost');
  });

  it('prévia de uma carteira inativa ainda é resolvida contra as demais ativas', () => {
    const c = customer();
    const a = newPortfolio('A', { active: false });
    const b = newPortfolio('B');
    cityOf(a, SERRA);
    cityOf(b, SERRA);
    expect(of(a, c)?.resolution).toBe('blocked');
    expect(of(b, c)?.resolution).toBe('assigned');
  });

  it('carteira de outra filial não concorre', () => {
    const c = customer({ branches: [ser, car] });
    const a = newPortfolio('A');
    const other = newPortfolio('Outra', { branch: car });
    hoodOf(other, SERRA, 'Centro');
    stateOf(a, ES);
    expect(of(a, c)).toEqual({ resolution: 'assigned', rank: 1 });
    expect(of(other, c)).toEqual({ resolution: 'assigned', rank: 3 });
  });

  it('rascunho e ativa concorrem entre si', () => {
    const c = customer();
    const draft = newPortfolio('rascunho', { status: 'draft' });
    const live = newPortfolio('ativa', { status: 'active' });
    stateOf(draft, ES);
    cityOf(live, SERRA);
    expect(of(draft, c)?.resolution).toBe('lost');
    expect(of(live, c)?.resolution).toBe('assigned');
  });

  it('carteira sem critério não concorre', () => {
    const c = customer();
    newPortfolio('vazia');
    const a = newPortfolio('A');
    stateOf(a, ES);
    expect(of(a, c)).toEqual({ resolution: 'assigned', rank: 1 });
  });

  it('cliente inativo ou sem vínculo ativo na filial não entra na disputa', () => {
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    stateOf(a, ES);
    stateOf(b, ES);
    customer({ active: false });
    customer({ branches: [car] });
    expect(view(a).total).toBe(0);
  });

  it('competitors: só concorrentes com posto, ordenados por posto desc e id', () => {
    const c = customer({ network: net });
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    const d = newPortfolio('D');
    const away = newPortfolio('fora', { branch: car });
    const noRank = newPortfolio('Sem posto');
    stateOf(a, ES);
    networkOf(b, net);
    cityOf(d, SERRA);
    stateOf(away, ES);
    stateOf(noRank, SP);
    const item = view(a).items[0];
    expect(item?.customerId).toBe(c);
    expect(item?.competitors).toEqual([
      { portfolioId: b, name: 'B', rank: 4 },
      { portfolioId: d, name: 'D', rank: 2 },
    ]);
    expect(item?.resolution).toBe('lost');
    expect(item?.rank).toBe(1);
  });
});

describe('conflitos: filtro, total e paginação', () => {
  function scenario() {
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    cityOf(a, SERRA);
    stateOf(b, ES);
    const cs = {
      lostInB: [] as number[],
      assignedInB: [] as number[],
      blocked: [] as number[],
    };
    // 7 clientes em Serra (A vence B), 4 em Vitória (só B), 5 empatam via bairro nas duas.
    for (let i = 0; i < 7; i++) cs.lostInB.push(customer());
    for (let i = 0; i < 4; i++) cs.assignedInB.push(customer({ municipality: VITORIA }));
    hoodOf(a, SERRA, 'Praia');
    hoodOf(b, SERRA, 'Praia');
    for (let i = 0; i < 5; i++) cs.blocked.push(customer({ neighborhood: 'Praia' }));
    return { a, b, cs };
  }

  it('filtro resolution e total coerentes', () => {
    const { b, cs } = scenario();
    expect(view(b).total).toBe(16);
    const lost = view(b, { resolution: 'lost' });
    expect(lost.total).toBe(7);
    expect(lost.items.map((i) => i.customerId)).toEqual(cs.lostInB);
    expect(view(b, { resolution: 'assigned' }).total).toBe(4);
    const blocked = view(b, { resolution: 'blocked' });
    expect(blocked.total).toBe(5);
    expect(blocked.items.every((i) => i.resolution === 'blocked')).toBe(true);
  });

  it('paginação: a soma das páginas é o total, sem repetição', () => {
    const { b } = scenario();
    for (const resolution of [undefined, 'lost', 'assigned', 'blocked'] as const) {
      const seen: number[] = [];
      let cursor: string | undefined;
      const totals = new Set<number>();
      do {
        const p = view(b, { resolution, limit: 3, ...(cursor ? { cursor } : {}) });
        totals.add(p.total);
        seen.push(...p.items.map((i) => i.customerId));
        cursor = p.nextCursor ?? undefined;
      } while (cursor);
      expect(totals.size).toBe(1); // o total é o mesmo em todas as páginas
      expect(seen).toHaveLength([...totals][0] as number);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it('serviço: filtro resolution, escopo e item completo', () => {
    const { b } = scenario();
    const svc = createEligibilityService(fx.db);
    const res = svc.preview(adminOf('SER'), b, { resolution: 'blocked', limit: 2 });
    expect(res.total).toBe(5);
    expect(res.items).toHaveLength(2);
    expect(res.items[0]).toMatchObject({
      resolution: 'blocked',
      rank: 3,
      competitors: [{ name: 'A', rank: 3 }],
    });
    expect(() => svc.preview(adminOf('SER'), b, { resolution: 'x' as never })).toThrow();
  });

  it('cursor além do fim: página vazia, mas o total segue correto', () => {
    const { b } = scenario();
    const beyond = Buffer.from('999999', 'utf8').toString('base64url');
    expect(view(b, { cursor: beyond })).toEqual({ items: [], nextCursor: null, total: 16 });
  });

  it('combina com source e q', () => {
    const { b } = scenario();
    expect(view(b, { resolution: 'lost' }).items.every((i) => i.source === 'filter')).toBe(true);
    const page = previewPage(fx.db, loadPortfolioCriteria(fx.db, b), {
      portfolioId: b,
      resolution: 'lost',
      source: 'manual',
    });
    expect(page.total).toBe(0);
  });
});

describe('conflitos: agregado e membros efetivos', () => {
  it('agregado traz conflictsBlocked e conflictsLost', () => {
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    cityOf(a, SERRA);
    stateOf(b, ES);
    customer();
    customer();
    customer({ municipality: VITORIA });
    hoodOf(a, SERRA, 'Praia');
    hoodOf(b, SERRA, 'Praia');
    customer({ neighborhood: 'Praia' });
    expect(loadAggregate(fx.db, a)).toMatchObject({ conflictsBlocked: 1, conflictsLost: 0 });
    expect(loadAggregate(fx.db, b)).toMatchObject({ conflictsBlocked: 1, conflictsLost: 2 });
  });

  it('as escritas devolvem o agregado com as contagens de conflito (lidas após o commit)', () => {
    const pfs = createPortfolioService(fx.db);
    const admin = adminOf('SER');
    const type = createPortfolioTypeService(fx.db).create(admin, { code: 'T1', name: 'Tipo 1' }).id;
    const mk = (name: string) =>
      pfs.create(admin, { name, branchId: ser, responsibleSub: 'resp', portfolioTypeId: type });
    const filters = {
      regions: [{ level: 'municipality' as const, stateCode: ES, municipalityCode: SERRA }],
      retailNetworkIds: [],
      economicGroupIds: [],
    };
    const a = mk('A');
    const b = mk('B');
    customer();
    customer();
    expect(a).toMatchObject({ conflictsBlocked: 0, conflictsLost: 0 });
    pfs.replaceFilters(admin, a.id, a.version, filters);
    const saved = pfs.replaceFilters(admin, b.id, b.version, filters);
    expect(saved).toMatchObject({ conflictsBlocked: 2, conflictsLost: 0 });
    expect(pfs.get(admin, a.id)).toMatchObject({ conflictsBlocked: 2, conflictsLost: 0 });
    expect(pfs.deactivate(admin, a.id, pfs.get(admin, a.id).version)).toMatchObject({ conflictsBlocked: 2 });
    expect(pfs.get(admin, b.id)).toMatchObject({ conflictsBlocked: 0, conflictsLost: 0 });
  });

  it('effectiveMembers devolve só os assigned, em ordem crescente de cliente', () => {
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    cityOf(a, SERRA);
    stateOf(b, ES);
    const inSerra = [customer(), customer(), customer()];
    const inVitoria = [customer({ municipality: VITORIA }), customer({ municipality: VITORIA })];
    // Serra: A (cidade, 2) vence B (UF, 1); Vitória: só B.
    expect([...effectiveMembers(fx.db, a)].map((m) => m.customerId)).toEqual(inSerra);
    const bMembers = [...effectiveMembers(fx.db, b)];
    expect(bMembers.map((m) => m.customerId)).toEqual(inVitoria);
    expect(bMembers[0]).toMatchObject({ rank: 1, source: 'filter', matchedRegionLevel: 'state' });
  });

  it('effectiveMembers deixa de fora blocked e lost, e inclui o manual que vence', () => {
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    cityOf(a, SERRA);
    cityOf(b, SERRA);
    const tied = customer();
    expect([...effectiveMembers(fx.db, a)]).toEqual([]); // empate: blocked nas duas
    expect([...effectiveMembers(fx.db, b)]).toEqual([]);
    override(a, tied, 'include'); // manual (6) vence a cidade (2); a origem segue 'filter' porque o cliente também casa o filtro
    expect([...effectiveMembers(fx.db, a)]).toMatchObject([{ customerId: tied, rank: 6, source: 'filter' }]);
    expect([...effectiveMembers(fx.db, b)]).toEqual([]); // lost
  });

  it('a prévia reflete mudança de estado sem cache (inativar a concorrente libera o cliente)', () => {
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    cityOf(a, SERRA);
    cityOf(b, SERRA);
    const c = customer();
    expect(of(b, c)?.resolution).toBe('blocked');
    expect([...effectiveMembers(fx.db, b)]).toEqual([]);
    sqlite().prepare('update portfolios set active = 0 where id = ?').run(a);
    expect(of(b, c)?.resolution).toBe('assigned');
    expect([...effectiveMembers(fx.db, b)].map((m) => m.customerId)).toEqual([c]);
    expect(loadAggregate(fx.db, b)).toMatchObject({ conflictsBlocked: 0, conflictsLost: 0 });
  });
});

describe('conflitos: volume sintético (50 mil clientes, 20 carteiras na filial)', () => {
  it('prévia com resolução dentro do teto', () => {
    const db = sqlite();
    const munis = db
      .prepare(
        'select ibge_code as code, state_code as st from municipalities where state_code in (32, 35) order by ibge_code limit 30',
      )
      .all() as { code: number; st: number }[];
    const nets = Array.from({ length: 8 }, (_, i) => seedRetailNetwork(fx.db, `VR${i}`));
    const grps = Array.from({ length: 5 }, (_, i) => seedEconomicGroup(fx.db, `VG${i}`));
    const N = 50_000;
    const insC = db.prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
        neighborhood_key, retail_network_id, economic_group_id, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,?,?,?,?,?,?,'t','t')`,
    );
    const insL = db.prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,?)');
    db.transaction(() => {
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
          i % 3 === 0 ? (nets[i % nets.length] as number) : null,
          i % 4 === 0 ? (grps[i % grps.length] as number) : null,
          i % 50 === 0 ? 0 : 1,
          NOW,
          NOW,
        ).lastInsertRowid as number;
        // Pior caso: praticamente todos vinculados (ativos) à filial da disputa.
        insL.run(id, ser, i % 40 === 0 ? 0 : 1);
        if (i % 7 === 0) insL.run(id, car, 1);
      }
    })();

    // 20 carteiras na mesma filial, com filtros sobrepostos.
    const ps: number[] = [];
    const mk = (name: string, setup: (p: number) => void, o: { active?: boolean } = {}) => {
      const p = newPortfolio(name, o);
      setup(p);
      ps.push(p);
      return p;
    };
    const at = (i: number) => munis[i] as { code: number; st: number };
    const broad = mk('UF ES+SP', (p) => {
      stateOf(p, ES);
      stateOf(p, SP);
      cityOf(p, at(12).code, at(12).st); // empata com 'Cidades dup' nessas duas cidades
      cityOf(p, at(13).code, at(13).st);
    });
    mk('Cidades dup', (p) => {
      cityOf(p, at(12).code, at(12).st);
      cityOf(p, at(13).code, at(13).st);
    });
    for (let i = 0; i < 4; i++)
      mk(`Cidades ${i}`, (p) => [0, 1, 2].forEach((k) => cityOf(p, at(i * 3 + k).code, at(i * 3 + k).st)));
    for (let i = 0; i < 4; i++) {
      mk(`Bairros ${i}`, (p) => {
        for (let k = 0; k < 3; k++) hoodOf(p, at(i * 2).code, `Bairro ${i * 3 + k}`, at(i * 2).st);
      });
    }
    for (let i = 0; i < 4; i++) mk(`Rede ${i}`, (p) => networkOf(p, nets[i] as number));
    for (let i = 0; i < 3; i++) mk(`Grupo ${i}`, (p) => groupOf(p, grps[i] as number));
    mk('Cidade + rede', (p) => {
      cityOf(p, at(0).code, at(0).st);
      networkOf(p, nets[0] as number);
    });
    mk('Manual A', (p) => {
      for (let i = 1; i <= 300; i++) override(p, i * 11, 'include');
    });
    mk('Manual B', (p) => {
      for (let i = 1; i <= 300; i++) override(p, i * 11 + (i % 2 ? 0 : 7), 'include');
    });
    mk('Inativa', (p) => stateOf(p, ES), { active: false });
    expect(ps.length).toBe(21); // 20 ativas + 1 inativa (não concorre)

    const criteria = loadPortfolioCriteria(fx.db, broad);
    const time = <T>(fn: () => T): [T, number] => {
      const t0 = performance.now();
      const r = fn();
      return [r, performance.now() - t0];
    };
    const [first, t1] = time(() => previewPage(fx.db, criteria, { portfolioId: broad, limit: 50 }));
    const [blocked, t2] = time(() =>
      previewPage(fx.db, criteria, { portfolioId: broad, limit: 50, resolution: 'blocked' }),
    );
    const [lost, t3] = time(() =>
      previewPage(fx.db, criteria, { portfolioId: broad, limit: 50, resolution: 'lost' }),
    );
    const [counts, t4] = time(() => loadAggregate(fx.db, broad));
    const manualA = ps[ps.length - 3] as number;
    const [manualPage, t5] = time(() =>
      previewPage(fx.db, loadPortfolioCriteria(fx.db, manualA), { portfolioId: manualA, limit: 50 }),
    );
    const [members, t6] = time(() => [...effectiveMembers(fx.db, broad)].length);

    expect(first.items).toHaveLength(50);
    expect(first.total).toBeGreaterThan(30_000);
    expect(blocked.total).toBeGreaterThan(0);
    expect(lost.total).toBeGreaterThan(0);
    expect(members).toBe(first.total - blocked.total - lost.total);
    expect(counts.conflictsBlocked).toBe(blocked.total);
    expect(counts.conflictsLost).toBe(lost.total);
    expect(manualPage.total).toBeGreaterThan(250); // alguns ajustes caem em clientes inativos ou sem vínculo

    const dialect = new SQLiteSyncDialect();
    const explain = (q: ReturnType<typeof previewIdsSql>) => {
      const { sql: text, params } = dialect.sqlToQuery(q);
      return (db.prepare(`explain query plan ${text}`).all(...params) as { detail: string }[])
        .map((r) => '  ' + r.detail)
        .join('\n');
    };
    console.log(
      `[conflitos 50k/20] total=${first.total} blocked=${blocked.total} lost=${lost.total} assigned=${members}\n` +
        `  1a pagina+total=${t1.toFixed(0)}ms | resolution=blocked=${t2.toFixed(0)}ms | resolution=lost=${t3.toFixed(0)}ms\n` +
        `  agregado(contagens)=${t4.toFixed(0)}ms | carteira manual=${t5.toFixed(0)}ms | effectiveMembers(tudo)=${t6.toFixed(0)}ms`,
    );
    console.log(`[conflitos 50k/20] EXPLAIN previa (ids, 1 execucao da disputa):
${explain(previewIdsSql(criteria, { portfolioId: broad }))}`);
    console.log(`[conflitos 50k/20] EXPLAIN contagens:\n${explain(conflictCountsSql(criteria, broad))}`);

    expect(t1).toBeLessThan(1500);
    expect(t2).toBeLessThan(1500);
    expect(t3).toBeLessThan(1500);
    expect(t4).toBeLessThan(1500);
    expect(t5).toBeLessThan(1500);
    expect(t6).toBeLessThan(1500);
  }, 120_000);
});
