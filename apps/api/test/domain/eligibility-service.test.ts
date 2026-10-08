import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEligibilityService, type EligibilityService } from '../../src/domain/eligibility/service.js';
import { createPortfolioTypeService } from '../../src/domain/portfolio-types/service.js';
import { createPortfolioService, type PortfolioService } from '../../src/domain/portfolios/service.js';
import { neighborhoodKey, searchKey } from '../../src/domain/shared/normalize.js';
import {
  ES,
  SERRA,
  SP,
  SAO_PAULO,
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
let svc: EligibilityService;
let pfs: PortfolioService;
let ser: number;
let car: number;
let typeId: number;
let seq = 0;
let pid: number;
let version: number;
const adminSer = adminOf('SER');
const adminCar = adminOf('CAR');
const readerSer = readerOf('SER');
const owner = actor({ sub: 'resp-1', roles: ['vendedor'], branches: ['SER'] });
const stranger = actor({ sub: 'outro', roles: ['vendedor'], branches: ['SER'] });

function customer(
  o: {
    name?: string;
    municipality?: number;
    state?: number;
    active?: boolean;
    branches?: [number, boolean][];
  } = {},
): number {
  seq += 1;
  const name = o.name ?? `Cliente ${seq}`;
  const id = fx.app.sqlite
    .prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, trade_name, trade_name_key, state_code,
        municipality_code, neighborhood, neighborhood_key, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      String(seq).padStart(14, '0'),
      name,
      searchKey(name),
      `Fantasia ${seq}`,
      searchKey(`Fantasia ${seq}`),
      o.state ?? ES,
      o.municipality ?? SERRA,
      'Centro',
      neighborhoodKey('Centro'),
      o.active === false ? 0 : 1,
      NOW,
      NOW,
      't',
      't',
    ).lastInsertRowid as number;
  for (const [branch, active] of o.branches ?? [[ser, true]]) {
    fx.app.sqlite
      .prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,?)')
      .run(id, branch, active ? 1 : 0);
  }
  return id;
}

/** Carteira em SER filtrando o ES inteiro; `version` acompanha o agregado. */
function newPortfolio(state: number | null = ES): number {
  const p = pfs.create(adminSer, {
    name: `Carteira ${++seq}`,
    branchId: ser,
    responsibleSub: 'resp-1',
    portfolioTypeId: typeId,
  });
  version = p.version;
  if (state !== null) {
    version = pfs.replaceFilters(adminSer, p.id, version, {
      regions: [{ level: 'state', stateCode: state }],
      retailNetworkIds: [],
      economicGroupIds: [],
    }).version;
  }
  return p.id;
}

const put = (
  who = adminSer,
  include: number[] = [],
  exclude: number[] = [],
  v: number | undefined = version,
) => {
  const res = svc.replaceOverrides(who, pid, v, { include, exclude });
  version = res.version;
  return res;
};
const previewIds = (who = adminSer, params = {}) =>
  svc.preview(who, pid, params).items.map((i) => i.customer.id);
const count = (table: string) =>
  (fx.app.sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

beforeEach(async () => {
  fx = await makeFixture();
  svc = createEligibilityService(fx.db);
  pfs = createPortfolioService(fx.db);
  ser = seedBranch(fx.db, 'SER');
  car = seedBranch(fx.db, 'CAR');
  typeId = createPortfolioTypeService(fx.db).create(adminSer, { code: 'T1', name: 'Tipo 1' }).id;
  pid = newPortfolio();
});
afterEach(async () => {
  await fx.app.close();
});

describe('prévia: leitura e escopo', () => {
  it('devolve só dado de empresa, com origem e nível', () => {
    const a = customer({ name: 'Farmácia Alfa', municipality: VITORIA });
    const out = svc.preview(readerSer, pid);
    expect(out.total).toBe(1);
    expect(out.nextCursor).toBeNull();
    expect(out.items[0]).toEqual({
      customer: {
        id: a,
        cnpj: expect.stringMatching(/^\d{14}$/),
        legalName: 'Farmácia Alfa',
        tradeName: expect.stringContaining('Fantasia'),
        stateCode: ES,
        municipalityCode: VITORIA,
        municipalityName: expect.any(String),
        neighborhood: 'Centro',
      },
      source: 'filter',
      matchedRegionLevel: 'state',
      matchedBy: { region: true, retailNetwork: false, economicGroup: false },
    });
  });

  it('outra filial e carteira inexistente dão 404; parâmetros inválidos dão 400', () => {
    expect(codeOf(() => svc.preview(adminCar, pid))).toBe('not_found');
    expect(codeOf(() => svc.preview(readerOf(), pid))).toBe('not_found');
    expect(codeOf(() => svc.preview(adminSer, 9999))).toBe('not_found');
    expect(codeOf(() => svc.getOverrides(adminCar, pid))).toBe('not_found');
    expect(codeOf(() => svc.preview(adminSer, pid, { limit: 0 }))).toBe('validation_error');
    expect(codeOf(() => svc.preview(adminSer, pid, { cursor: '!!' }))).toBe('validation_error');
  });

  it('pagina por cursor, com total estável', () => {
    const made = [customer(), customer(), customer()];
    const first = svc.preview(adminSer, pid, { limit: 2 });
    expect(first.items.map((i) => i.customer.id)).toEqual(made.slice(0, 2));
    expect(first.total).toBe(3);
    const next = svc.preview(adminSer, pid, { limit: 2, cursor: first.nextCursor as string });
    expect(next.items.map((i) => i.customer.id)).toEqual([made[2]]);
    expect(next.nextCursor).toBeNull();
  });
});

describe('ajustes: escrita e permissões', () => {
  it('leitor lê, mas não grava (403); admin e responsável gravam; outro vendedor não', () => {
    const c = customer();
    expect(codeOf(() => put(readerSer, [], [c]))).toBe('forbidden');
    expect(codeOf(() => put(stranger, [], [c]))).toBe('forbidden');
    expect(() => svc.getOverrides(readerSer, pid)).not.toThrow();
    expect(put(owner, [], [c]).overridesExclude).toBe(1);
    expect(put(adminSer, [], []).overridesExclude).toBe(0);
  });

  it('outra filial recebe 404 na escrita', () => {
    expect(codeOf(() => put(adminCar))).toBe('not_found');
  });

  it('carteira inativa dá 409 portfolio_inactive, antes do conflito de versão', () => {
    pfs.deactivate(adminSer, pid, version);
    expect(codeOf(() => put(adminSer, [], [], version))).toBe('portfolio_inactive');
    expect(codeOf(() => put(adminSer, [], [], 1))).toBe('portfolio_inactive');
  });

  it('versão: ausente 428, velha 409; sucesso incrementa uma vez', () => {
    expect(codeOf(() => svc.replaceOverrides(adminSer, pid, undefined, { include: [], exclude: [] }))).toBe(
      'precondition_required',
    );
    const before = version;
    expect(codeOf(() => put(adminSer, [], [], before + 5))).toBe('version_conflict');
    const res = put(adminSer, [customer()], []);
    expect(res.version).toBe(before + 1);
    expect(codeOf(() => put(adminSer, [], [], before))).toBe('version_conflict');
  });

  it('grava autor e data; a ordem de erros mantém o 403 antes da versão ausente', () => {
    const c = customer();
    put(owner, [], [c]);
    const row = fx.app.sqlite
      .prepare('select created_by, created_at from portfolio_customer_overrides')
      .get();
    expect(row).toMatchObject({ created_by: 'resp-1' });
    expect(codeOf(() => svc.replaceOverrides(readerSer, pid, undefined, { include: [], exclude: [] }))).toBe(
      'forbidden',
    );
  });
});

describe('ajustes: validações', () => {
  it('repetição e interseção dão 400', () => {
    const a = customer();
    const b = customer();
    expect(codeOf(() => put(adminSer, [a, a], []))).toBe('validation_error');
    expect(codeOf(() => put(adminSer, [], [b, b]))).toBe('validation_error');
    expect(codeOf(() => put(adminSer, [a], [a]))).toBe('validation_error');
    expect(codeOf(() => put(adminSer, [0], []))).toBe('validation_error');
    expect(codeOf(() => put(adminSer, [1.5], []))).toBe('validation_error');
    expect(codeOf(() => svc.replaceOverrides(adminSer, pid, version, { include: [a] } as never))).toBe(
      'validation_error',
    );
  });

  it('limite de 5.000 no total', () => {
    const include = Array.from({ length: 3000 }, (_, i) => i + 1);
    const exclude = Array.from({ length: 2001 }, (_, i) => i + 10_000);
    expect(codeOf(() => put(adminSer, include, exclude))).toBe('validation_error');
    const tooMany = Array.from({ length: 5001 }, (_, i) => i + 1);
    expect(codeOf(() => put(adminSer, tooMany, []))).toBe('validation_error');
  });

  it('cliente de outra filial ou inexistente: 400, sem diferenciar', () => {
    const elsewhere = customer({ branches: [[car, true]] });
    const messages = [elsewhere, 987_654].map((id) => {
      try {
        put(adminSer, [], [id]);
      } catch (err) {
        return { code: (err as { code: string }).code, message: (err as Error).message };
      }
      return null;
    });
    expect(messages[0]).toEqual(messages[1]);
    expect(messages[0]?.code).toBe('validation_error');
    expect(messages[0]?.message).not.toContain(String(elsewhere));
    expect(codeOf(() => put(adminSer, [elsewhere], []))).toBe('validation_error');
  });

  it('o escopo é o do ator: cliente da filial CAR passa para quem tem as duas filiais', () => {
    const both = customer({
      branches: [
        [ser, true],
        [car, true],
      ],
    });
    expect(put(adminOf('SER', 'CAR'), [both], []).overridesInclude).toBe(1);
  });

  it('inclusão exige cliente ativo e vínculo ativo na filial da carteira', () => {
    const inactive = customer({ active: false });
    const linkOff = customer({ branches: [[ser, false]] });
    const otherBranchOnly = customer({ branches: [[car, true]] });
    const scoped = adminOf('SER', 'CAR');
    expect(codeOf(() => put(adminSer, [inactive], []))).toBe('validation_error');
    expect(codeOf(() => put(adminSer, [linkOff], []))).toBe('validation_error');
    expect(codeOf(() => put(scoped, [otherBranchOnly], []))).toBe('validation_error');
    // exclusão aceita qualquer cliente do escopo
    expect(put(adminSer, [], [inactive, linkOff]).overridesExclude).toBe(2);
  });
});

describe('ajustes: efeito na prévia', () => {
  it('prévia reflete inclusão manual e exclusão', () => {
    const inFilter = customer();
    const outFilter = customer({ municipality: SAO_PAULO, state: SP });
    expect(previewIds()).toEqual([inFilter]);
    put(adminSer, [outFilter], [inFilter]);
    const items = svc.preview(adminSer, pid).items;
    expect(items.map((i) => i.customer.id)).toEqual([outFilter]);
    expect(items[0]).toMatchObject({ source: 'manual', matchedRegionLevel: null });
    expect(previewIds(adminSer, { source: 'filter' })).toEqual([]);
  });

  it('getOverrides: effective de exclusão depende de casar o filtro hoje', () => {
    const matches = customer();
    const noMatch = customer({ municipality: SAO_PAULO, state: SP });
    const manual = customer({ municipality: SAO_PAULO, state: SP });
    put(adminSer, [manual], [matches, noMatch]);
    const got = svc.getOverrides(readerSer, pid);
    expect(got.include.map((e) => [e.customer.id, e.effective])).toEqual([[manual, true]]);
    expect(got.exclude.map((e) => [e.customer.id, e.effective])).toEqual([
      [matches, true],
      [noMatch, false],
    ]);
    expect(got.include[0]?.customer).not.toHaveProperty('createdBy');
  });

  it('inclusão que perde a validade some da prévia e vira effective:false', () => {
    const manual = customer({ municipality: SAO_PAULO, state: SP });
    put(adminSer, [manual], []);
    expect(previewIds()).toEqual([manual]);
    fx.app.sqlite.prepare('update customer_branches set active = 0 where customer_id = ?').run(manual);
    expect(previewIds()).toEqual([]);
    expect(svc.getOverrides(adminSer, pid).include).toEqual([expect.objectContaining({ effective: false })]);
    fx.app.sqlite.prepare('update customer_branches set active = 1 where customer_id = ?').run(manual);
    fx.app.sqlite.prepare('update customers set active = 0 where id = ?').run(manual);
    expect(svc.getOverrides(adminSer, pid).include[0]?.effective).toBe(false);
  });

  it('substituir troca o conjunto inteiro, e um cliente muda de lista', () => {
    const a = customer();
    const b = customer();
    put(adminSer, [a], [b]);
    put(adminSer, [b], [a]);
    const got = svc.getOverrides(adminSer, pid);
    expect(got.include.map((e) => e.customer.id)).toEqual([b]);
    expect(got.exclude.map((e) => e.customer.id)).toEqual([a]);
    put(adminSer, [], []);
    expect(count('portfolio_customer_overrides')).toBe(0);
  });

  it('carteira sem filtro: a prévia é só a inclusão manual', () => {
    pid = newPortfolio(null);
    const a = customer();
    expect(previewIds()).toEqual([]);
    put(adminSer, [a], []);
    expect(previewIds()).toEqual([a]);
  });

  it('contagens aparecem no agregado da carteira', () => {
    const [a, b, c] = [customer(), customer(), customer()] as [number, number, number];
    expect(pfs.get(adminSer, pid)).toMatchObject({ overridesInclude: 0, overridesExclude: 0 });
    put(adminSer, [a], [b, c]);
    expect(pfs.get(adminSer, pid)).toMatchObject({ overridesInclude: 1, overridesExclude: 2 });
  });
});

describe('ajustes: atomicidade', () => {
  it('falha no meio da gravação preserva os ajustes anteriores e a versão', () => {
    const a = customer();
    const b = customer();
    const c = customer();
    put(adminSer, [], [a]);
    const before = version;
    fx.app.sqlite.exec(
      `create trigger boom before insert on portfolio_customer_overrides
       when new.customer_id = ${c} begin select raise(abort, 'falha injetada'); end`,
    );
    expect(() => put(adminSer, [b], [c])).toThrow();
    expect(svc.getOverrides(adminSer, pid).exclude.map((e) => e.customer.id)).toEqual([a]);
    expect(svc.getOverrides(adminSer, pid).include).toEqual([]);
    expect(pfs.get(adminSer, pid).version).toBe(before);
    version = before;
  });
});
