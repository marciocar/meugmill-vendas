import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProductSubgroupService } from '../../src/domain/catalog/service.js';
import { createPortfolioTypeService } from '../../src/domain/portfolio-types/service.js';
import { createPortfolioService, type PortfolioService } from '../../src/domain/portfolios/service.js';
import { createSellerService } from '../../src/domain/sellers/service.js';
import {
  ES,
  SAO_PAULO,
  SERRA,
  SP,
  VITORIA,
  actor,
  adminOf,
  codeOf,
  makeFixture,
  readerOf,
  seedBranch,
  seedEconomicGroup,
  seedRetailNetwork,
  type Fixture,
} from '../helpers/seed.js';

let fx: Fixture;
let svc: PortfolioService;
let ser: number;
let car: number;
let typeId: number;
let typeB: number;
let sellerId: number;
let subgroupId: number;
let subgroupB: number;
const adminSer = adminOf('SER');
const adminCar = adminOf('CAR');
const adminBoth = adminOf('SER', 'CAR');
const readerSer = readerOf('SER');
const owner = actor({ sub: 'resp-1', roles: ['vendedor'], branches: ['SER'] });

beforeEach(async () => {
  fx = await makeFixture();
  svc = createPortfolioService(fx.db);
  ser = seedBranch(fx.db, 'SER');
  car = seedBranch(fx.db, 'CAR');
  const types = createPortfolioTypeService(fx.db);
  typeId = types.create(adminSer, { code: 'T1', name: 'Tipo 1' }).id;
  typeB = types.create(adminSer, { code: 'T2', name: 'Tipo 2' }).id;
  const groups = createProductSubgroupService(fx.db);
  subgroupId = groups.create(adminSer, { code: 'SG1', name: 'Genéricos' }).id;
  subgroupB = groups.create(adminSer, { code: 'SG2', name: 'Similares' }).id;
  sellerId = createSellerService(fx.db).create(adminBoth, {
    code: 'V1',
    name: 'Vendedor 1',
    branchIds: [ser],
  }).id;
});
afterEach(async () => {
  await fx.app.close();
});

const draft = (over: Record<string, unknown> = {}) =>
  svc.create(adminSer, {
    name: 'Norte Farmácias',
    branchId: ser,
    responsibleSub: 'resp-1',
    portfolioTypeId: typeId,
    ...over,
  });
const noFilters = { regions: [], retailNetworkIds: [], economicGroupIds: [] };

describe('carteira: criar', () => {
  it('cria rascunho vazio, v1, ativo, sem dado pessoal', () => {
    const p = draft({ name: '  Norte   Farmácias ', description: ' texto ' });
    expect(p).toMatchObject({
      name: 'Norte Farmácias',
      description: 'texto',
      status: 'draft',
      active: true,
      version: 1,
      responsibleSub: 'resp-1',
      branch: { id: ser, code: 'SER' },
      type: { id: typeId, code: 'T1' },
      filters: { regions: [], retailNetworks: [], economicGroups: [] },
      sellers: [],
    });
    expect(Object.keys(p)).not.toContain('createdBy');
    expect(draft({ name: 'Outra' }).description).toBeNull();
  });

  it('só admin com a filial no token cria', () => {
    const input = { name: 'X', branchId: ser, responsibleSub: 'r', portfolioTypeId: typeId };
    expect(codeOf(() => svc.create(readerSer, input))).toBe('forbidden');
    expect(codeOf(() => svc.create(owner, input))).toBe('forbidden');
    expect(codeOf(() => svc.create(adminCar, input))).toBe('forbidden');
  });

  it('valida nome, tipo e campos extras', () => {
    expect(codeOf(() => draft({ name: '   ' }))).toBe('validation_error');
    expect(codeOf(() => draft({ name: 'a'.repeat(121) }))).toBe('validation_error');
    expect(draft({ name: 'a'.repeat(120) }).name).toHaveLength(120);
    expect(codeOf(() => draft({ portfolioTypeId: 9999 }))).toBe('validation_error');
    expect(codeOf(() => draft({ responsibleSub: '  ' }))).toBe('validation_error');
    expect(codeOf(() => draft({ email: 'a@b.c' }))).toBe('validation_error');
    createPortfolioTypeService(fx.db).deactivate(adminSer, typeB, 1);
    expect(codeOf(() => draft({ portfolioTypeId: typeB }))).toBe('validation_error');
  });

  it('nome único por filial pela chave normalizada, inclusive inativa', () => {
    const p = draft({ name: 'Norte — Farmácias' });
    expect(codeOf(() => draft({ name: 'NORTE — FARMACIAS' }))).toBe('conflict');
    svc.deactivate(adminSer, p.id, 1);
    expect(codeOf(() => draft({ name: 'norte — farmacias' }))).toBe('conflict');
    // mesmo nome em outra filial é permitido
    expect(
      svc.create(adminBoth, {
        name: 'Norte — Farmácias',
        branchId: car,
        responsibleSub: 'r',
        portfolioTypeId: typeId,
      }).branch.code,
    ).toBe('CAR');
  });
});

describe('carteira: leitura e escopo', () => {
  it('leitor da filial lê; outra filial recebe 404', () => {
    const p = draft();
    expect(svc.get(readerSer, p.id)).toEqual(p);
    expect(codeOf(() => svc.get(adminCar, p.id))).toBe('not_found');
    expect(codeOf(() => svc.get(readerOf(), p.id))).toBe('not_found');
    expect(codeOf(() => svc.get(adminSer, 9999))).toBe('not_found');
    expect(svc.list(adminCar).items).toEqual([]);
    expect(svc.list(readerSer).items).toHaveLength(1);
  });

  it('ator de outra filial recebe 404 (não 403) em toda escrita', () => {
    const p = draft();
    expect(codeOf(() => svc.update(adminCar, p.id, 1, { name: 'Z' }))).toBe('not_found');
    expect(codeOf(() => svc.replaceFilters(adminCar, p.id, 1, noFilters))).toBe('not_found');
    expect(codeOf(() => svc.replaceSellers(adminCar, p.id, 1, { assignments: [] }))).toBe('not_found');
    expect(codeOf(() => svc.deactivate(adminCar, p.id, 1))).toBe('not_found');
    expect(codeOf(() => svc.reactivate(adminCar, p.id, 1))).toBe('not_found');
  });

  it('lista resumida com contagens, filtros, busca sem acento e paginação', () => {
    const net = seedRetailNetwork(fx.db, 'R1');
    const grp = seedEconomicGroup(fx.db, 'G1');
    const a = draft({ name: 'Região Sul' });
    const b = draft({ name: 'Capixaba', responsibleSub: 'outro' });
    svc.replaceFilters(adminSer, a.id, 1, {
      regions: [{ level: 'state', stateCode: ES }],
      retailNetworkIds: [net],
      economicGroupIds: [grp],
    });
    svc.replaceSellers(adminSer, a.id, 2, {
      assignments: [
        { sellerId, productSubgroupId: subgroupId },
        { sellerId, productSubgroupId: subgroupB },
      ],
    });
    svc.deactivate(adminSer, b.id, 1);

    const all = svc.list(readerSer).items;
    expect(all.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(all[0]).toEqual({
      id: a.id,
      name: 'Região Sul',
      branch: { id: ser, code: 'SER', name: 'Filial SER' },
      type: { id: typeId, code: 'T1', name: 'Tipo 1' },
      status: 'draft',
      active: true,
      responsibleSub: 'resp-1',
      regionsCount: 1,
      retailNetworksCount: 1,
      economicGroupsCount: 1,
      sellersCount: 1,
      version: 3,
    });
    expect(svc.list(readerSer, { q: 'regiao' }).items.map((i) => i.id)).toEqual([a.id]);
    expect(svc.list(readerSer, { q: 'REGIÃO s' }).items).toHaveLength(1);
    expect(svc.list(readerSer, { q: '%' }).items).toHaveLength(0);
    expect(svc.list(readerSer, { active: false }).items.map((i) => i.id)).toEqual([b.id]);
    expect(svc.list(readerSer, { status: 'active' }).items).toEqual([]);
    expect(svc.list(readerSer, { status: 'draft' }).items).toHaveLength(2);
    expect(svc.list(readerSer, { responsibleSub: 'outro' }).items.map((i) => i.id)).toEqual([b.id]);
    expect(svc.list(readerSer, { branchId: ser }).items).toHaveLength(2);
    expect(svc.list(readerSer, { branchId: car }).items).toEqual([]);
    const page = svc.list(readerSer, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(svc.list(readerSer, { limit: 1, cursor: page.nextCursor as string }).items[0]?.id).toBe(b.id);
    expect(codeOf(() => svc.list(readerSer, { limit: 0 }))).toBe('validation_error');
  });
});

describe('carteira: update e autorização por dono', () => {
  it('admin altera informações; versão e ETag sobem uma vez', () => {
    const p = draft();
    const u = svc.update(adminSer, p.id, 1, { name: 'Novo nome', description: null, portfolioTypeId: typeB });
    expect(u).toMatchObject({ name: 'Novo nome', description: null, version: 2, type: { id: typeB } });
    expect(codeOf(() => svc.update(adminSer, p.id, 2, {} as never))).toBe('validation_error');
  });

  it('responsável edita informações, filtros e vendedores, mas não troca filial nem responsável', () => {
    const p = svc.create(adminBoth, {
      name: 'Minha',
      branchId: ser,
      responsibleSub: 'resp-1',
      portfolioTypeId: typeId,
    });
    const respBoth = actor({ sub: 'resp-1', roles: ['vendedor'], branches: ['SER', 'CAR'] });
    expect(svc.update(owner, p.id, 1, { name: 'Minha 2' }).version).toBe(2);
    expect(svc.update(owner, p.id, 2, { responsibleSub: 'resp-1' }).version).toBe(3); // sem troca
    expect(
      svc.replaceFilters(owner, p.id, 3, { ...noFilters, regions: [{ level: 'state', stateCode: ES }] })
        .version,
    ).toBe(4);
    expect(
      svc.replaceSellers(owner, p.id, 4, { assignments: [{ sellerId, productSubgroupId: subgroupId }] })
        .version,
    ).toBe(5);
    expect(codeOf(() => svc.update(owner, p.id, 5, { branchId: car }))).toBe('forbidden');
    expect(codeOf(() => svc.update(respBoth, p.id, 5, { branchId: car }))).toBe('forbidden');
    expect(codeOf(() => svc.update(owner, p.id, 5, { responsibleSub: 'outro' }))).toBe('forbidden');
    expect(codeOf(() => svc.deactivate(owner, p.id, 5))).toBe('forbidden');
    expect(svc.get(owner, p.id)).toMatchObject({
      version: 5,
      responsibleSub: 'resp-1',
      branch: { code: 'SER' },
    });
  });

  it('leitor da filial lê mas não edita (403)', () => {
    const p = draft();
    expect(codeOf(() => svc.update(readerSer, p.id, 1, { name: 'Z' }))).toBe('forbidden');
    expect(codeOf(() => svc.replaceFilters(readerSer, p.id, 1, noFilters))).toBe('forbidden');
    expect(codeOf(() => svc.replaceSellers(readerSer, p.id, 1, { assignments: [] }))).toBe('forbidden');
    expect(codeOf(() => svc.deactivate(readerSer, p.id, 1))).toBe('forbidden');
    expect(codeOf(() => svc.reactivate(readerSer, p.id, 1))).toBe('forbidden');
  });

  it('admin troca o responsável', () => {
    const p = draft();
    expect(svc.update(adminSer, p.id, 1, { responsibleSub: ' novo-resp ' }).responsibleSub).toBe('novo-resp');
    // o antigo responsável perde o poder de edição
    expect(codeOf(() => svc.update(owner, p.id, 2, { name: 'Z' }))).toBe('forbidden');
  });

  it('renomear com conflito -> conflict; o mesmo nome em si mesmo é permitido', () => {
    draft({ name: 'A' });
    const b = draft({ name: 'B' });
    expect(codeOf(() => svc.update(adminSer, b.id, 1, { name: 'a' }))).toBe('conflict');
    expect(svc.update(adminSer, b.id, 1, { name: 'b' }).version).toBe(2);
  });

  it('troca de filial: nova filial no token, compatível com os vendedores, sem colisão de nome', () => {
    const p = draft();
    expect(codeOf(() => svc.update(adminSer, p.id, 1, { branchId: car }))).toBe('forbidden'); // CAR fora do token
    expect(svc.update(adminBoth, p.id, 1, { branchId: car })).toMatchObject({
      branch: { code: 'CAR' },
      version: 2,
    });
    expect(codeOf(() => svc.update(adminBoth, p.id, 2, { branchId: 9999 }))).toBe('forbidden');
  });

  it('trocar filial com vendedores sem vínculo ativo na filial nova -> 400', () => {
    const p = draft();
    svc.replaceSellers(adminSer, p.id, 1, { assignments: [{ sellerId, productSubgroupId: subgroupId }] });
    expect(codeOf(() => svc.update(adminBoth, p.id, 2, { branchId: car }))).toBe('validation_error');
    expect(svc.get(adminBoth, p.id).branch.code).toBe('SER');
    // com vínculo ativo na filial nova, passa
    createSellerService(fx.db).update(adminBoth, sellerId, 1, { branchIds: [ser, car] });
    expect(svc.update(adminBoth, p.id, 2, { branchId: car }).branch.code).toBe('CAR');
  });

  it('trocar filial para nome já usado lá -> conflict', () => {
    const p = draft();
    svc.create(adminBoth, {
      name: 'Norte Farmácias',
      branchId: car,
      responsibleSub: 'r',
      portfolioTypeId: typeId,
    });
    expect(codeOf(() => svc.update(adminBoth, p.id, 1, { branchId: car }))).toBe('conflict');
  });
});

describe('carteira: filtros', () => {
  it('regiões em três níveis, bairro normalizado, redes e grupos; PUT vazio limpa', () => {
    const net = seedRetailNetwork(fx.db, 'R1');
    const grp = seedEconomicGroup(fx.db, 'G1');
    const p = draft();
    const out = svc.replaceFilters(adminSer, p.id, 1, {
      regions: [
        { level: 'state', stateCode: SP },
        { level: 'municipality', stateCode: ES, municipalityCode: VITORIA },
        {
          level: 'neighborhood',
          stateCode: ES,
          municipalityCode: SERRA,
          neighborhoodLabel: '  Jardim  Câmburi ',
        },
      ],
      retailNetworkIds: [net],
      economicGroupIds: [grp],
    });
    expect(out.version).toBe(2);
    expect(out.filters.regions).toHaveLength(3);
    expect(out.filters.regions[0]).toEqual({ level: 'state', stateCode: SP, uf: 'SP' });
    expect(out.filters.regions[1]).toMatchObject({
      level: 'municipality',
      uf: 'ES',
      municipalityCode: VITORIA,
    });
    expect(out.filters.regions[1]?.municipalityName).toBeTruthy();
    expect(out.filters.regions[2]).toMatchObject({
      level: 'neighborhood',
      municipalityCode: SERRA,
      neighborhoodKey: 'JARDIM CAMBURI',
      neighborhoodLabel: 'Jardim Câmburi',
    });
    expect(out.filters.retailNetworks).toEqual([{ id: net, code: 'R1', name: 'Rede R1' }]);
    expect(out.filters.economicGroups).toEqual([{ id: grp, code: 'G1', name: 'Grupo G1' }]);

    const cleared = svc.replaceFilters(adminSer, p.id, 2, noFilters);
    expect(cleared.filters).toEqual({ regions: [], retailNetworks: [], economicGroups: [] });
    expect(cleared.version).toBe(3);
  });

  it('níveis incoerentes, IBGE inválido e bairro sem município -> 400', () => {
    const p = draft();
    const put = (region: Record<string, unknown>) =>
      codeOf(() => svc.replaceFilters(adminSer, p.id, 1, { ...noFilters, regions: [region as never] }));
    expect(put({ level: 'state', stateCode: ES, municipalityCode: SERRA })).toBe('validation_error');
    expect(put({ level: 'state', stateCode: ES, neighborhoodLabel: 'X' })).toBe('validation_error');
    expect(put({ level: 'municipality', stateCode: ES })).toBe('validation_error');
    expect(
      put({ level: 'municipality', stateCode: ES, municipalityCode: SERRA, neighborhoodLabel: 'X' }),
    ).toBe('validation_error');
    expect(put({ level: 'neighborhood', stateCode: ES, neighborhoodLabel: 'Centro' })).toBe(
      'validation_error',
    );
    expect(put({ level: 'neighborhood', stateCode: ES, municipalityCode: SERRA })).toBe('validation_error');
    expect(
      put({ level: 'neighborhood', stateCode: ES, municipalityCode: SERRA, neighborhoodLabel: '   ' }),
    ).toBe('validation_error');
    expect(put({ level: 'state', stateCode: 99 })).toBe('validation_error');
    expect(put({ level: 'municipality', stateCode: ES, municipalityCode: 1234567 })).toBe('validation_error');
    expect(put({ level: 'municipality', stateCode: ES, municipalityCode: SAO_PAULO })).toBe(
      'validation_error',
    );
    expect(put({ level: 'cidade', stateCode: ES })).toBe('validation_error');
    expect(svc.get(adminSer, p.id).version).toBe(1);
  });

  it('duplicatas no mesmo PUT -> 400 (bairro compara pela chave normalizada)', () => {
    const net = seedRetailNetwork(fx.db, 'R1');
    const grp = seedEconomicGroup(fx.db, 'G1');
    const p = draft();
    const bairro = (label: string) => ({
      level: 'neighborhood' as const,
      stateCode: ES,
      municipalityCode: SERRA,
      neighborhoodLabel: label,
    });
    const run = (over: Record<string, unknown>) =>
      codeOf(() => svc.replaceFilters(adminSer, p.id, 1, { ...noFilters, ...over } as never));
    expect(run({ regions: [bairro('Centro'), bairro(' CENTRO ')] })).toBe('validation_error');
    expect(
      run({
        regions: [
          { level: 'state', stateCode: ES },
          { level: 'state', stateCode: ES },
        ],
      }),
    ).toBe('validation_error');
    expect(run({ retailNetworkIds: [net, net] })).toBe('validation_error');
    expect(run({ economicGroupIds: [grp, grp] })).toBe('validation_error');
    // mesmo local em níveis diferentes não é duplicata
    expect(
      run({
        regions: [
          { level: 'state', stateCode: ES },
          { level: 'municipality', stateCode: ES, municipalityCode: SERRA },
        ],
      }),
    ).toBe('no_error');
  });

  it('redes e grupos inexistentes ou inativos -> 400', () => {
    const off = seedRetailNetwork(fx.db, 'R9', false);
    const p = draft();
    const run = (over: Record<string, unknown>) =>
      codeOf(() => svc.replaceFilters(adminSer, p.id, 1, { ...noFilters, ...over } as never));
    expect(run({ retailNetworkIds: [off] })).toBe('validation_error');
    expect(run({ retailNetworkIds: [9999] })).toBe('validation_error');
    expect(run({ economicGroupIds: [9999] })).toBe('validation_error');
  });

  it('limites: regiões, redes, grupos', () => {
    const p = draft();
    const many = Array.from({ length: 501 }, (_, i) => ({
      level: 'neighborhood',
      stateCode: ES,
      municipalityCode: SERRA,
      neighborhoodLabel: `B${i}`,
    }));
    expect(
      codeOf(() => svc.replaceFilters(adminSer, p.id, 1, { ...noFilters, regions: many as never })),
    ).toBe('validation_error');
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    expect(codeOf(() => svc.replaceFilters(adminSer, p.id, 1, { ...noFilters, retailNetworkIds: ids }))).toBe(
      'validation_error',
    );
    expect(codeOf(() => svc.replaceFilters(adminSer, p.id, 1, { ...noFilters, economicGroupIds: ids }))).toBe(
      'validation_error',
    );
    const ok = many.slice(0, 500);
    expect(
      svc.replaceFilters(adminSer, p.id, 1, { ...noFilters, regions: ok as never }).filters.regions,
    ).toHaveLength(500);
  });
});

describe('carteira: vendedores', () => {
  it('substitui pares, vários subgrupos por vendedor; vazio limpa', () => {
    const p = draft();
    const out = svc.replaceSellers(adminSer, p.id, 1, {
      assignments: [
        { sellerId, productSubgroupId: subgroupB },
        { sellerId, productSubgroupId: subgroupId },
      ],
    });
    expect(out.sellers).toEqual([
      {
        seller: { id: sellerId, code: 'V1', name: 'Vendedor 1' },
        productSubgroup: { id: subgroupId, code: 'SG1', name: 'Genéricos' },
      },
      {
        seller: { id: sellerId, code: 'V1', name: 'Vendedor 1' },
        productSubgroup: { id: subgroupB, code: 'SG2', name: 'Similares' },
      },
    ]);
    expect(svc.replaceSellers(adminSer, p.id, 2, { assignments: [] }).sellers).toEqual([]);
  });

  it('vendedor sem vínculo com a filial, só com vínculo inativo ou inativo global -> 400', () => {
    const sellers = createSellerService(fx.db);
    const p = draft();
    const run = (id: number) =>
      codeOf(() =>
        svc.replaceSellers(adminSer, p.id, 1, {
          assignments: [{ sellerId: id, productSubgroupId: subgroupId }],
        }),
      );
    const other = sellers.create(adminCar, { code: 'V2', name: 'Outro', branchIds: [car] }).id;
    expect(run(other)).toBe('validation_error'); // só na outra filial
    expect(run(9999)).toBe('validation_error');
    sellers.deactivate(adminSer, sellerId, 1); // vínculo SER inativo; global segue ativo
    expect(run(sellerId)).toBe('validation_error');
    sellers.reactivate(adminSer, sellerId, 2);
    expect(run(sellerId)).toBe('no_error');
    sellers.deactivateGlobal(adminSer, sellerId, 3);
    expect(
      codeOf(() =>
        svc.replaceSellers(adminSer, p.id, 2, { assignments: [{ sellerId, productSubgroupId: subgroupId }] }),
      ),
    ).toBe('validation_error');
  });

  it('subgrupo inativo ou inexistente e duplicata de par -> 400', () => {
    const p = draft();
    createProductSubgroupService(fx.db).deactivate(adminSer, subgroupB, 1);
    const run = (assignments: unknown[]) =>
      codeOf(() => svc.replaceSellers(adminSer, p.id, 1, { assignments } as never));
    expect(run([{ sellerId, productSubgroupId: subgroupB }])).toBe('validation_error');
    expect(run([{ sellerId, productSubgroupId: 9999 }])).toBe('validation_error');
    expect(
      run([
        { sellerId, productSubgroupId: subgroupId },
        { sellerId, productSubgroupId: subgroupId },
      ]),
    ).toBe('validation_error');
    expect(run([{ sellerId, productSubgroupId: subgroupId, extra: 1 }])).toBe('validation_error');
  });

  it('limite de 500 pares', () => {
    const p = draft();
    const pairs = Array.from({ length: 501 }, (_, i) => ({ sellerId: i + 1, productSubgroupId: i + 1 }));
    expect(codeOf(() => svc.replaceSellers(adminSer, p.id, 1, { assignments: pairs }))).toBe(
      'validation_error',
    );
  });
});

describe('carteira: concorrência e atomicidade', () => {
  it('toda escrita exige a versão; ausente -> 428; velha -> 409', () => {
    const p = draft();
    expect(codeOf(() => svc.update(adminSer, p.id, undefined, { name: 'Z' }))).toBe('precondition_required');
    expect(codeOf(() => svc.replaceFilters(adminSer, p.id, undefined, noFilters))).toBe(
      'precondition_required',
    );
    expect(codeOf(() => svc.replaceSellers(adminSer, p.id, undefined, { assignments: [] }))).toBe(
      'precondition_required',
    );
    expect(codeOf(() => svc.deactivate(adminSer, p.id, undefined))).toBe('precondition_required');
    expect(codeOf(() => svc.update(adminSer, p.id, 7, { name: 'Z' }))).toBe('version_conflict');
    expect(codeOf(() => svc.replaceFilters(adminSer, p.id, 7, noFilters))).toBe('version_conflict');
    expect(codeOf(() => svc.deactivate(adminSer, p.id, 7))).toBe('version_conflict');
  });

  it('duas edições com a mesma versão: a segunda dá 409 e nada é aplicado', () => {
    const p = draft();
    svc.replaceFilters(adminSer, p.id, 1, { ...noFilters, regions: [{ level: 'state', stateCode: ES }] });
    expect(
      codeOf(() =>
        svc.replaceSellers(adminSer, p.id, 1, { assignments: [{ sellerId, productSubgroupId: subgroupId }] }),
      ),
    ).toBe('version_conflict');
    const got = svc.get(adminSer, p.id);
    expect(got.sellers).toEqual([]);
    expect(got.version).toBe(2);
  });

  it('rollback: falha no meio da substituição preserva filhos e versão', () => {
    const net = seedRetailNetwork(fx.db, 'R1');
    const p = draft();
    svc.replaceFilters(adminSer, p.id, 1, { ...noFilters, regions: [{ level: 'state', stateCode: ES }] });
    // Falha injetada: a inserção de redes aborta, depois de apagar e inserir as regiões.
    fx.app.sqlite.exec(
      `create trigger boom before insert on portfolio_retail_networks begin select raise(abort, 'falha injetada'); end`,
    );
    expect(() =>
      svc.replaceFilters(adminSer, p.id, 2, {
        regions: [{ level: 'state', stateCode: SP }],
        retailNetworkIds: [net],
        economicGroupIds: [],
      }),
    ).toThrow();
    const got = svc.get(adminSer, p.id);
    expect(got.version).toBe(2);
    expect(got.filters.regions).toEqual([{ level: 'state', stateCode: ES, uf: 'ES' }]);
    expect(got.filters.retailNetworks).toEqual([]);

    fx.app.sqlite.exec(
      `drop trigger boom; create trigger boom2 before insert on portfolio_sellers begin select raise(abort, 'falha injetada'); end`,
    );
    expect(() =>
      svc.replaceSellers(adminSer, p.id, 2, { assignments: [{ sellerId, productSubgroupId: subgroupId }] }),
    ).toThrow();
    expect(svc.get(adminSer, p.id)).toEqual(got);
  });

  it('auditoria: updated_by/updated_at registrados', () => {
    let t = 1_000;
    const timed = createPortfolioService(fx.db, { now: () => t });
    const p = timed.create(adminSer, {
      name: 'T',
      branchId: ser,
      responsibleSub: 'r',
      portfolioTypeId: typeId,
    });
    t = 2_000;
    timed.replaceFilters(actor({ sub: 'editor', roles: ['admin'], branches: ['SER'] }), p.id, 1, noFilters);
    const row = fx.app.sqlite
      .prepare('select updated_at, updated_by, created_by from portfolios where id = ?')
      .get(p.id);
    expect(row).toEqual({ updated_at: 2_000, updated_by: 'editor', created_by: 'user-1' });
    expect(timed.get(adminSer, p.id)).toMatchObject({ createdAt: 1_000, updatedAt: 2_000 });
  });
});

describe('carteira: inativar e reativar', () => {
  it('globais, só admin, idempotentes; status continua rascunho', () => {
    const p = draft();
    const off = svc.deactivate(adminSer, p.id, 1);
    expect(off).toMatchObject({ active: false, version: 2, status: 'draft' });
    expect(off.deactivatedAt).not.toBeNull();
    expect(svc.deactivate(adminSer, p.id, 2)).toEqual(off); // idempotente
    expect(svc.deactivate(adminSer, p.id, 2).version).toBe(2);
    const on = svc.reactivate(adminSer, p.id, 2);
    expect(on).toMatchObject({ active: true, version: 3, deactivatedAt: null });
    expect(svc.reactivate(adminSer, p.id, 3).version).toBe(3);
  });
});
