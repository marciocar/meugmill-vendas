import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEligibilityService, type EligibilityService } from '../../src/domain/eligibility/service.js';
import { createCustomerService } from '../../src/domain/customers/service.js';
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

/** Muitos clientes ativos vinculados a SER, numa transação (volume de teste de limite). */
function bulkCustomers(n: number): number[] {
  const insC = fx.app.sqlite.prepare(
    `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
      neighborhood_key, active, created_at, updated_at, created_by, updated_by)
     values (?,?,?,?,?,?,?,1,?,?,'t','t')`,
  );
  const insL = fx.app.sqlite.prepare(
    'insert into customer_branches (customer_id, branch_id, active) values (?,?,1)',
  );
  const out: number[] = [];
  fx.app.sqlite.transaction(() => {
    for (let i = 0; i < n; i++) {
      seq += 1;
      const id = insC.run(
        String(seq).padStart(14, '0'),
        `Lote ${seq}`,
        `LOTE ${seq}`,
        ES,
        SERRA,
        'Centro',
        neighborhoodKey('Centro'),
        NOW,
        NOW,
      ).lastInsertRowid as number;
      insL.run(id, ser);
      out.push(id);
    }
  })();
  return out;
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
      rank: 1,
      resolution: 'assigned',
      competitors: [],
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

  it('limite de 5.000 com clientes reais: 5.000 persistem; 5.001 dá 400 com a mensagem do limite', () => {
    const ids = bulkCustomers(5001);
    put(adminSer, ids.slice(0, 3000), ids.slice(3000, 5000));
    expect(count('portfolio_customer_overrides')).toBe(5000);
    expect(pfs.get(adminSer, pid)).toMatchObject({ overridesInclude: 3000, overridesExclude: 2000 });
    const before = version;
    const err = (() => {
      try {
        put(adminSer, ids.slice(0, 3000), ids.slice(3000, 5001));
      } catch (e) {
        return e as Error & { code: string };
      }
      return null;
    })();
    expect(err?.code).toBe('validation_error');
    expect(err?.message).toBe('Limite de ajustes excedido');
    expect(count('portfolio_customer_overrides')).toBe(5000);
    expect(pfs.get(adminSer, pid).version).toBe(before);
  });

  it('5.000 inclusões válidas: replaceOverrides, getOverrides e prévia funcionam (sem estourar variáveis do SQLite)', () => {
    const ids = bulkCustomers(5000);
    const saved = put(adminSer, ids, []);
    expect(saved).toMatchObject({ overridesInclude: 5000, overridesExclude: 0 });
    expect(count('portfolio_customer_overrides')).toBe(5000);
    const read = svc.getOverrides(adminSer, pid);
    expect(read.include).toHaveLength(5000);
    expect(read.include.every((o) => o.effective)).toBe(true);
    // O mesmo vale para 5.000 exclusões (efetivas: os clientes casam o filtro da carteira).
    const again = put(adminSer, [], ids);
    expect(again).toMatchObject({ overridesInclude: 0, overridesExclude: 5000 });
    const excluded = svc.getOverrides(adminSer, pid);
    expect(excluded.exclude).toHaveLength(5000);
    expect(excluded.exclude.every((o) => o.effective)).toBe(true);
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

  it('cliente só da filial CAR em carteira de SER: 400, mesmo para quem tem as duas filiais', () => {
    const carOnly = customer({ branches: [[car, true]] });
    const both = adminOf('SER', 'CAR');
    expect(codeOf(() => put(both, [carOnly], []))).toBe('validation_error');
    expect(codeOf(() => put(both, [], [carOnly]))).toBe('validation_error');
    expect(count('portfolio_customer_overrides')).toBe(0);
  });

  it('cliente com as duas filiais é aceito (o vínculo com a filial da carteira basta)', () => {
    const shared = customer({
      branches: [
        [ser, true],
        [car, true],
      ],
    });
    expect(put(adminOf('SER', 'CAR'), [shared], []).overridesInclude).toBe(1);
  });

  it('inclusão exige cliente ativo e vínculo ativo na filial da carteira', () => {
    const inactive = customer({ active: false });
    const linkOff = customer({ branches: [[ser, false]] });
    const otherBranchOnly = customer({ branches: [[car, true]] });
    const scoped = adminOf('SER', 'CAR');
    expect(codeOf(() => put(adminSer, [inactive], []))).toBe('validation_error');
    expect(codeOf(() => put(adminSer, [linkOff], []))).toBe('validation_error');
    expect(codeOf(() => put(scoped, [otherBranchOnly], []))).toBe('validation_error');
    // exclusão aceita cliente inativo ou com vínculo inativo na filial da carteira
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

describe('ajustes: vazamento de escopo entre filiais (regressão)', () => {
  const both = adminOf('SER', 'CAR');

  it('admin SER+CAR não consegue gravar exclusão de cliente só de CAR em carteira de SER', () => {
    const carOnly = customer({ name: 'Segredo CAR', branches: [[car, true]] });
    expect(codeOf(() => put(both, [], [carOnly]))).toBe('validation_error');
    const shown = JSON.stringify(svc.getOverrides(readerSer, pid));
    expect(shown).not.toContain('Segredo CAR');
  });

  it('troca de filial com ajustes sem vínculo na filial nova: 400, sem trocar nada', () => {
    const p = pfs.create(both, {
      name: 'Carteira CAR',
      branchId: car,
      responsibleSub: 'r',
      portfolioTypeId: typeId,
    });
    const carOnly = customer({ branches: [[car, true]] });
    const res = svc.replaceOverrides(both, p.id, p.version, { include: [carOnly], exclude: [] });
    expect(codeOf(() => pfs.update(both, p.id, res.version, { branchId: ser }))).toBe('validation_error');
    const after = pfs.get(both, p.id);
    expect(after.branch.code).toBe('CAR');
    expect(after.version).toBe(res.version);
  });

  it('troca de filial passa quando todos os clientes ajustados têm vínculo (ativo ou não) na filial nova', () => {
    const p = pfs.create(both, {
      name: 'Carteira CAR 2',
      branchId: car,
      responsibleSub: 'r',
      portfolioTypeId: typeId,
    });
    const a = customer({
      branches: [
        [car, true],
        [ser, true],
      ],
    });
    const b = customer({
      branches: [
        [car, true],
        [ser, false],
      ],
    });
    const res = svc.replaceOverrides(both, p.id, p.version, { include: [a], exclude: [b] });
    expect(pfs.update(both, p.id, res.version, { branchId: ser }).branch.code).toBe('SER');
  });

  it('getOverrides omite ajustes de clientes sem vínculo com a filial da carteira', () => {
    const visible = customer({ name: 'Visível' });
    const hidden = customer({ name: 'Segredo CAR', branches: [[car, true]] });
    put(adminSer, [], [visible]);
    // ajuste órfão (cliente sem vínculo com SER), gravado direto; o caminho pela API está em "ajustes órfãos"
    fx.app.sqlite
      .prepare("insert into portfolio_customer_overrides values (?,?,'exclude',?,'t')")
      .run(pid, hidden, NOW);
    const forReader = svc.getOverrides(readerSer, pid);
    expect(forReader.exclude.map((e) => e.customer.id)).toEqual([visible]);
    expect(JSON.stringify(forReader)).not.toContain('Segredo CAR');
    // órfão não aparece para ninguém, nem para quem enxerga a outra filial
    expect(svc.getOverrides(both, pid).exclude.map((e) => e.customer.id)).toEqual([visible]);
  });
});

describe('prévia: estado muda entre chamadas (sem cache)', () => {
  it('filtro trocado, cliente mudou de bairro e vínculo reativado', () => {
    const inEs = customer();
    const inSp = customer({ state: SP, municipality: SAO_PAULO });
    expect(previewIds()).toEqual([inEs]);
    version = pfs.replaceFilters(adminSer, pid, version, {
      regions: [{ level: 'state', stateCode: SP }],
      retailNetworkIds: [],
      economicGroupIds: [],
    }).version;
    expect(previewIds()).toEqual([inSp]);

    version = pfs.replaceFilters(adminSer, pid, version, {
      regions: [
        { level: 'neighborhood', stateCode: ES, municipalityCode: SERRA, neighborhoodLabel: 'Laranjeiras' },
      ],
      retailNetworkIds: [],
      economicGroupIds: [],
    }).version;
    expect(previewIds()).toEqual([]);
    fx.app.sqlite
      .prepare('update customers set neighborhood = ?, neighborhood_key = ? where id = ?')
      .run('Laranjeiras', neighborhoodKey('Laranjeiras'), inEs);
    expect(previewIds()).toEqual([inEs]);

    fx.app.sqlite.prepare('update customer_branches set active = 0 where customer_id = ?').run(inEs);
    expect(previewIds()).toEqual([]);
    fx.app.sqlite.prepare('update customer_branches set active = 1 where customer_id = ?').run(inEs);
    expect(previewIds()).toEqual([inEs]);
  });
});

describe('prévia: paginação com ajustes', () => {
  it('inclusões e exclusões intercaladas: cada cliente uma vez e soma das páginas = total', () => {
    const inFilter = Array.from({ length: 7 }, () => customer());
    const outFilter = Array.from({ length: 5 }, () => customer({ state: SP, municipality: SAO_PAULO }));
    // exclui um sim, outro não; inclui alguns de fora do filtro, intercalados
    put(
      adminSer,
      [outFilter[0] as number, outFilter[2] as number, outFilter[4] as number],
      [inFilter[1] as number, inFilter[3] as number, inFilter[5] as number],
    );
    const walk = (params: object) => {
      const seen: number[] = [];
      let cursor: string | undefined;
      let total: number | undefined;
      do {
        const page = svc.preview(adminSer, pid, { limit: 2, ...params, ...(cursor ? { cursor } : {}) });
        total = page.total;
        seen.push(...page.items.map((i) => i.customer.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return { seen, total };
    };
    const all = walk({});
    expect(new Set(all.seen).size).toBe(all.seen.length);
    expect(all.seen).toHaveLength(all.total ?? -1);
    expect(all.total).toBe(7 - 3 + 3);
    expect(all.seen).toEqual([...all.seen].sort((x, y) => x - y));
  });

  it('q + source + ajustes: soma das páginas = total', () => {
    const named = Array.from({ length: 6 }, (_, i) => customer({ name: `Alfa ${i}` }));
    const manual = Array.from({ length: 4 }, (_, i) =>
      customer({ name: `Alfa fora ${i}`, state: SP, municipality: SAO_PAULO }),
    );
    customer({ name: 'Beta' });
    put(adminSer, [manual[0] as number, manual[1] as number, manual[3] as number], [named[2] as number]);
    for (const source of ['filter', 'manual', undefined] as const) {
      const seen: number[] = [];
      let cursor: string | undefined;
      let total: number | undefined;
      do {
        const page = svc.preview(adminSer, pid, {
          q: 'alfa',
          limit: 2,
          ...(source ? { source } : {}),
          ...(cursor ? { cursor } : {}),
        });
        total = page.total;
        seen.push(...page.items.map((i) => i.customer.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(total ?? -1);
      expect(total).toBe({ filter: 5, manual: 3, undefined: 8 }[String(source) as 'filter']);
    }
  });
});

describe('versão compartilhada entre E3 e E4', () => {
  it('PUT filtros e PUT ajustes incrementam a mesma versão e o agregado traz as contagens', () => {
    const a = customer();
    const b = customer();
    const start = version;
    const f = pfs.replaceFilters(adminSer, pid, version, {
      regions: [{ level: 'state', stateCode: ES }],
      retailNetworkIds: [],
      economicGroupIds: [],
    });
    expect(f.version).toBe(start + 1);
    const o = svc.replaceOverrides(adminSer, pid, f.version, { include: [a], exclude: [b] });
    expect(o.version).toBe(start + 2);
    expect(o).toMatchObject({ overridesInclude: 1, overridesExclude: 1 });
    // a versão velha de filtros já não vale para ajustes
    expect(codeOf(() => svc.replaceOverrides(adminSer, pid, f.version, { include: [], exclude: [] }))).toBe(
      'version_conflict',
    );
  });
});

describe('ajustes órfãos (cliente perdeu o vínculo com a filial da carteira)', () => {
  const both = adminOf('SER', 'CAR');
  const rows = () => count('portfolio_customer_overrides');

  /** Cria o órfão pela API de clientes: update de branchIds removendo SER. */
  function orphanize(id: number): void {
    createCustomerService(fx.db).update(both, id, 1, { branchIds: [car] });
  }
  const shared = () =>
    customer({
      branches: [
        [ser, true],
        [car, true],
      ],
    });

  it('não aparece em GET /overrides, nas contagens nem na prévia; o PUT o apaga', () => {
    const orphan = shared();
    const kept = shared();
    put(adminSer, [orphan], [kept]);
    expect(pfs.get(adminSer, pid)).toMatchObject({ overridesInclude: 1, overridesExclude: 1 });
    orphanize(orphan);

    const o = svc.getOverrides(adminSer, pid);
    expect(o.include).toEqual([]);
    expect(o.exclude.map((e) => e.customer.id)).toEqual([kept]);
    expect(pfs.get(adminSer, pid)).toMatchObject({ overridesInclude: 0, overridesExclude: 1 });
    expect(previewIds()).not.toContain(orphan);
    expect(rows()).toBe(2); // a linha continua gravada, só não é vista nem contada

    const res = svc.replaceOverrides(adminSer, pid, version, { include: [], exclude: [kept] });
    expect(res).toMatchObject({ overridesInclude: 0, overridesExclude: 1 });
    expect(rows()).toBe(1);
  });

  it('troca de filial válida descarta o órfão e incrementa a versão uma vez', () => {
    const orphan = shared();
    const kept = shared();
    put(adminSer, [orphan], [kept]);
    orphanize(orphan);
    const before = version;
    const res = pfs.update(both, pid, before, { branchId: car });
    expect(res.branch.code).toBe('CAR');
    expect(res.version).toBe(before + 1);
    expect(rows()).toBe(1);
    expect(res).toMatchObject({ overridesInclude: 0, overridesExclude: 1 });
  });

  it('troca recusada por ajuste não órfão incompatível mantém tudo, inclusive o órfão e a versão', () => {
    const orphan = shared();
    const serOnly = customer();
    put(adminSer, [orphan], [serOnly]);
    orphanize(orphan);
    const before = version;
    expect(codeOf(() => pfs.update(both, pid, before, { branchId: car }))).toBe('validation_error');
    const after = pfs.get(both, pid);
    expect(after.branch.code).toBe('SER');
    expect(after.version).toBe(before);
    expect(rows()).toBe(2);
  });
});
