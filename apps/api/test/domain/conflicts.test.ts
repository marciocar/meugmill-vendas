import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectiveMembers } from '../../src/domain/conflicts/members.js';
import {
  loadPortfolioCriteria,
  previewPage,
  type ResolvedPage,
  type Resolution,
} from '../../src/domain/eligibility/query.js';
import { createEligibilityService } from '../../src/domain/eligibility/service.js';
import { createPortfolioTypeService } from '../../src/domain/portfolio-types/service.js';
import { createPortfolioService } from '../../src/domain/portfolios/service.js';
import { loadAggregateBase, withConflicts } from '../../src/domain/portfolios/aggregate.js';
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
/** Agregado da carteira com as contagens de conflito (sob demanda). */
const counts = (p: number) => withConflicts(fx.db, loadAggregateBase(fx.db, p));
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

  it('cliente inativo ou sem vínculo ativo na filial não entra na disputa, nem como membro nem como concorrente', () => {
    const a = newPortfolio('A');
    const b = newPortfolio('B');
    stateOf(a, ES);
    cityOf(b, SERRA);
    const valid = customer();
    const inactive = customer({ active: false });
    const otherBranch = customer({ branches: [car] });
    const inactiveLink = customer();
    sqlite()
      .prepare('update customer_branches set active = 0 where customer_id = ? and branch_id = ?')
      .run(inactiveLink, ser);
    // Ajustes manuais de B sobre os inválidos também não devem fazê-los concorrer em A.
    for (const c of [inactive, otherBranch, inactiveLink]) override(b, c, 'include');
    expect(view(a).items.map((i) => i.customerId)).toEqual([valid]);
    expect(view(a).total).toBe(1);
    expect(view(b).items.map((i) => i.customerId)).toEqual([valid]);
    expect(view(a).items[0]?.competitors).toEqual([{ portfolioId: b, name: 'B', rank: 2 }]);
    expect(of(a, valid)).toEqual({ resolution: 'lost', rank: 1 });
    expect(of(b, valid)).toEqual({ resolution: 'assigned', rank: 2 });
    expect(counts(a)).toMatchObject({ conflictsBlocked: 0, conflictsLost: 1 });
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
    expect(counts(a)).toMatchObject({ conflictsBlocked: 1, conflictsLost: 0 });
    expect(counts(b)).toMatchObject({ conflictsBlocked: 1, conflictsLost: 2 });
  });

  it('contagens de conflito só sob demanda: o GET padrão e as escritas não as calculam', () => {
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
    // Nenhuma escrita (create, replaceFilters, deactivate) devolve as contagens.
    const savedA = pfs.replaceFilters(admin, a.id, a.version, filters);
    const savedB = pfs.replaceFilters(admin, b.id, b.version, filters);
    for (const written of [a, savedA, savedB]) {
      expect(written).not.toHaveProperty('conflictsBlocked');
      expect(written).not.toHaveProperty('conflictsLost');
    }
    expect(pfs.get(admin, b.id)).not.toHaveProperty('conflictsBlocked');
    // Sob demanda, refletem o estado já gravado.
    expect(pfs.get(admin, a.id, 'conflicts')).toMatchObject({ conflictsBlocked: 2, conflictsLost: 0 });
    expect(pfs.get(admin, b.id, 'conflicts')).toMatchObject({ conflictsBlocked: 2, conflictsLost: 0 });
    const off = pfs.deactivate(admin, a.id, savedA.version);
    expect(off).not.toHaveProperty('conflictsBlocked');
    expect(pfs.get(admin, b.id, 'conflicts')).toMatchObject({ conflictsBlocked: 0, conflictsLost: 0 });
    expect(pfs.get(admin, a.id, 'conflicts')).toMatchObject({ conflictsBlocked: 2, conflictsLost: 0 });
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
    expect(counts(b)).toMatchObject({ conflictsBlocked: 0, conflictsLost: 0 });
  });
});
