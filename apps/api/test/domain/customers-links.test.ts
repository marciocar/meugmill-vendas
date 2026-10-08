import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCustomerService, type CustomerService } from '../../src/domain/customers/service.js';
import type { CreateCustomerInput } from '../../src/domain/customers/schemas.js';
import {
  CNPJ_A,
  CNPJ_B,
  CNPJ_C,
  CNPJ_D,
  SAO_PAULO,
  SERRA,
  adminOf,
  codeOf,
  makeFixture,
  seedBranch,
  seedEconomicGroup,
  seedRetailNetwork,
  type Fixture,
} from '../helpers/seed.js';

let fx: Fixture;
let svc: CustomerService;
let ser: number;
let car: number;

const adminSer = adminOf('SER');
const adminCar = adminOf('CAR');
const adminBoth = adminOf('SER', 'CAR');

const base = (over: Partial<CreateCustomerInput> = {}): CreateCustomerInput => ({
  cnpj: CNPJ_A,
  legalName: 'Farmácia Central Ltda',
  municipalityCode: SERRA,
  neighborhood: 'Centro',
  branchIds: [ser],
  ...over,
});

const linkRows = (customerId: number) =>
  fx.app.sqlite
    .prepare('select branch_id, active from customer_branches where customer_id = ? order by branch_id')
    .all(customerId) as { branch_id: number; active: number }[];
const globalRow = (id: number) =>
  fx.app.sqlite.prepare('select active, version from customers where id = ?').get(id) as {
    active: number;
    version: number;
  };

beforeEach(async () => {
  fx = await makeFixture();
  svc = createCustomerService(fx.db);
  ser = seedBranch(fx.db, 'SER');
  car = seedBranch(fx.db, 'CAR');
});
afterEach(async () => {
  await fx.app.close();
});

describe('clientes: link por CNPJ sem vazamento e ativo por vínculo', () => {
  it('cenário do achado: A liga o cliente de B, lê, inativa só o vínculo dele e não afeta B', () => {
    const c = svc.create(adminCar, base({ branchIds: [car] }));
    expect(codeOf(() => svc.get(adminSer, c.id))).toBe('not_found');

    const linked = svc.linkCustomerToBranchByCnpj(adminSer, CNPJ_A, ser);
    expect(linked).toEqual({ id: c.id, version: 2 }); // nada além disso
    expect(Object.keys(linked).sort()).toEqual(['id', 'version']);
    expect(svc.get(adminSer, c.id).legalName).toBe('Farmácia Central Ltda'); // agora no escopo

    const off = svc.deactivate(adminSer, c.id, 2);
    expect(off).toMatchObject({ active: false, version: 3 });
    expect(off.branches).toEqual([{ id: ser, code: 'SER', name: 'Filial SER', active: false }]);
    expect(globalRow(c.id).active).toBe(1);
    expect(linkRows(c.id)).toEqual([
      { branch_id: ser, active: 0 },
      { branch_id: car, active: 1 },
    ]);

    const asCar = svc.get(adminCar, c.id);
    expect(asCar).toMatchObject({ active: true, version: 3 });
    expect(asCar.branches).toEqual([{ id: car, code: 'CAR', name: 'Filial CAR', active: true }]);
    expect(svc.list(adminCar, { active: true }).items).toHaveLength(1);
    expect(svc.list(adminSer, { active: true }).items).toHaveLength(0);
    expect(svc.list(adminSer, { active: false }).items).toHaveLength(1);
  });

  it('dados compartilhados: admin parcial não altera, mas pode mexer só nos vínculos', () => {
    const c = svc.create(adminCar, base({ branchIds: [car] }));
    svc.linkCustomerToBranchByCnpj(adminSer, CNPJ_A, ser); // v2
    expect(codeOf(() => svc.update(adminSer, c.id, 2, { legalName: 'Outro Nome' }))).toBe('forbidden');
    expect(globalRow(c.id).version).toBe(2);
    // admin com A e B altera
    expect(svc.update(adminBoth, c.id, 2, { legalName: 'Outro Nome' })).toMatchObject({
      legalName: 'Outro Nome',
      version: 3,
    });
  });

  it.each([
    ['legalName', { legalName: 'Novo' }],
    ['tradeName', { tradeName: 'Fantasia' }],
    ['municipalityCode', { municipalityCode: SAO_PAULO }],
    ['stateCode', { stateCode: 35 }],
    ['neighborhood', { neighborhood: 'Outro Bairro' }],
    ['retailNetworkId', { retailNetworkId: 1 }],
    ['economicGroupId', { economicGroupId: 1 }],
  ])('campo compartilhado %s exige todas as filiais (403)', (_name, patch) => {
    const c = svc.create(adminCar, base({ branchIds: [car] }));
    svc.linkCustomerToBranchByCnpj(adminSer, CNPJ_A, ser); // v2
    expect(codeOf(() => svc.update(adminSer, c.id, 2, patch))).toBe('forbidden');
    expect(globalRow(c.id).version).toBe(2);
  });

  it('reenviar o mesmo valor não conta como alteração de dado compartilhado', () => {
    const c = svc.create(adminCar, base({ branchIds: [car], tradeName: 'Fantasia' }));
    svc.linkCustomerToBranchByCnpj(adminSer, CNPJ_A, ser);
    const u = svc.update(adminSer, c.id, 2, {
      legalName: ' Farmácia  Central Ltda ',
      tradeName: 'Fantasia',
      municipalityCode: SERRA,
      neighborhood: 'Centro',
      branchIds: [ser],
    });
    expect(u.version).toBe(3);
  });

  it('só branchIds (dentro do escopo) é permitido a qualquer admin com >= 1 filial do registro', () => {
    const c = svc.create(adminCar, base({ branchIds: [car] }));
    svc.linkCustomerToBranchByCnpj(adminSer, CNPJ_A, ser);
    const u = svc.update(adminSer, c.id, 2, { branchIds: [] });
    expect(u.branches).toEqual([]);
    expect(linkRows(c.id)).toEqual([{ branch_id: car, active: 1 }]);
  });

  it('admin com todas as filiais: deactivate/reactivate mexem só nos vínculos; global segue ativo', () => {
    const c = svc.create(adminBoth, base({ branchIds: [ser, car] }));
    const off = svc.deactivate(adminBoth, c.id, 1);
    expect(off).toMatchObject({ active: false, version: 2 });
    expect(globalRow(c.id).active).toBe(1);
    expect(linkRows(c.id).every((l) => l.active === 0)).toBe(true);

    const on = svc.reactivate(adminBoth, c.id, 2);
    expect(on).toMatchObject({ active: true, version: 3, deactivatedAt: null });
    expect(globalRow(c.id).active).toBe(1);
    expect(linkRows(c.id).every((l) => l.active === 1)).toBe(true);
  });

  it('deactivate-global com cobertura total: global inativo, vínculos intactos, some de active=true', () => {
    const c = svc.create(adminBoth, base({ branchIds: [ser, car] }));
    const off = svc.deactivateGlobal(adminBoth, c.id, 1);
    expect(off).toMatchObject({ active: false, version: 2 });
    expect(globalRow(c.id)).toEqual({ active: 0, version: 2 });
    expect(linkRows(c.id).every((l) => l.active === 1)).toBe(true);
    for (const who of [adminSer, adminCar, adminBoth]) {
      expect(svc.list(who, { active: true }).items).toHaveLength(0);
      expect(svc.list(who, { active: false }).items).toHaveLength(1);
      expect(svc.get(who, c.id).active).toBe(false);
    }
    // idempotente: repetir não muda a versão nem exige If-Match atual
    expect(svc.deactivateGlobal(adminBoth, c.id, 1)).toMatchObject({ version: 2 });

    // reativar os vínculos (já ativos) é no-op e não reativa o global
    expect(svc.reactivate(adminSer, c.id, 2)).toMatchObject({ active: false, version: 2 });
    const on = svc.reactivateGlobal(adminBoth, c.id, 2);
    expect(on).toMatchObject({ active: true, version: 3 });
    expect(globalRow(c.id)).toEqual({ active: 1, version: 3 });
    expect(svc.list(adminCar, { active: true }).items).toHaveLength(1);
    expect(svc.reactivateGlobal(adminBoth, c.id, 1)).toMatchObject({ version: 3 }); // idempotente
  });

  it('deactivate-global/reactivate-global sem cobertura total: 403 sem mudar a versão', () => {
    const c = svc.create(adminBoth, base({ branchIds: [ser, car] }));
    expect(codeOf(() => svc.deactivateGlobal(adminSer, c.id, 1))).toBe('forbidden');
    expect(globalRow(c.id)).toEqual({ active: 1, version: 1 });
    svc.deactivateGlobal(adminBoth, c.id, 1);
    expect(codeOf(() => svc.reactivateGlobal(adminSer, c.id, 2))).toBe('forbidden');
    expect(globalRow(c.id)).toEqual({ active: 0, version: 2 });
    // não-admin
    expect(codeOf(() => svc.deactivateGlobal({ ...adminBoth, roles: [] }, c.id, 2))).toBe('forbidden');
  });

  it('rotas globais: 428 sem If-Match, 409 com versão velha, 404 fora do escopo', () => {
    const c = svc.create(adminBoth, base({ branchIds: [ser, car] }));
    expect(codeOf(() => svc.deactivateGlobal(adminBoth, c.id, undefined))).toBe('precondition_required');
    expect(codeOf(() => svc.reactivateGlobal(adminBoth, c.id, undefined))).toBe('precondition_required');
    svc.deactivate(adminSer, c.id, 1); // v2
    expect(codeOf(() => svc.deactivateGlobal(adminBoth, c.id, 1))).toBe('version_conflict');
    expect(globalRow(c.id)).toEqual({ active: 1, version: 2 });
    const other = svc.create(adminCar, base({ cnpj: CNPJ_B, branchIds: [car] }));
    expect(codeOf(() => svc.deactivateGlobal(adminSer, other.id, 1))).toBe('not_found');
    expect(codeOf(() => svc.reactivateGlobal(adminSer, other.id, 1))).toBe('not_found');
    expect(globalRow(other.id)).toEqual({ active: 1, version: 1 });
  });

  it('reativar vínculos não reativa o registro global inativo', () => {
    const c = svc.create(adminBoth, base({ branchIds: [ser, car] }));
    svc.deactivate(adminBoth, c.id, 1); // vínculos (v2)
    svc.deactivateGlobal(adminBoth, c.id, 2); // global (v3)
    const partial = svc.reactivate(adminSer, c.id, 3);
    expect(partial.version).toBe(4);
    expect(partial.branches[0]).toMatchObject({ code: 'SER', active: true });
    expect(partial.active).toBe(false); // registro global ainda inativo
    expect(globalRow(c.id).active).toBe(0);
    expect(linkRows(c.id)).toEqual([
      { branch_id: ser, active: 1 },
      { branch_id: car, active: 0 },
    ]);
  });

  it('é idempotente por vínculo: repetir não muda a versão nem exige If-Match atual', () => {
    const c = svc.create(adminBoth, base({ branchIds: [ser, car] }));
    const off = svc.deactivate(adminSer, c.id, 1);
    expect(off.version).toBe(2);
    expect(svc.deactivate(adminSer, c.id, 1)).toEqual(off); // versão velha, mas nada a mudar
    expect(svc.reactivate(adminCar, c.id, 2)).toMatchObject({ version: 2 }); // CAR já ativo
    expect(globalRow(c.id).version).toBe(2);
  });

  it('deactivate/reactivate de cliente fora do escopo: 404 sem mudar a versão', () => {
    const c = svc.create(adminCar, base({ branchIds: [car] }));
    expect(codeOf(() => svc.deactivate(adminSer, c.id, 1))).toBe('not_found');
    expect(codeOf(() => svc.reactivate(adminSer, c.id, 1))).toBe('not_found');
    expect(globalRow(c.id)).toEqual({ active: 1, version: 1 });
    expect(linkRows(c.id)).toEqual([{ branch_id: car, active: 1 }]);
  });

  it('o link incrementa a versão e PATCH com a versão antiga dá version_conflict', () => {
    const c = svc.create(adminBoth, base({ branchIds: [ser] }));
    expect(svc.linkCustomerToBranchByCnpj(adminCar, CNPJ_A, car).version).toBe(2);
    expect(codeOf(() => svc.update(adminBoth, c.id, 1, { legalName: 'X' }))).toBe('version_conflict');
    expect(svc.update(adminBoth, c.id, 2, { legalName: 'X' }).version).toBe(3);
  });

  it('dois PATCH com a mesma versão: o segundo é version_conflict', () => {
    const c = svc.create(adminSer, base());
    svc.update(adminSer, c.id, 1, { legalName: 'Primeiro' });
    expect(codeOf(() => svc.update(adminSer, c.id, 1, { legalName: 'Segundo' }))).toBe('version_conflict');
    expect(svc.get(adminSer, c.id).legalName).toBe('Primeiro');
  });

  it('PATCH de branchIds parcial preserva o vínculo oculto (conferido no banco)', () => {
    const third = seedBranch(fx.db, 'TER');
    const c = svc.create(adminOf('SER', 'CAR', 'TER'), base({ branchIds: [ser, car, third] }));
    const u = svc.update(adminOf('SER', 'TER'), c.id, 1, { branchIds: [third] });
    expect(u.branches.map((b) => b.code)).toEqual(['TER']);
    expect(linkRows(c.id).map((l) => l.branch_id)).toEqual([car, third]);
  });
});

describe('clientes: filial, rede e grupo inativos', () => {
  it('inativar filial/rede/grupo não esconde nem trava clientes já ligados', () => {
    const net = seedRetailNetwork(fx.db, 'R1');
    const grp = seedEconomicGroup(fx.db, 'G1');
    const net2 = seedRetailNetwork(fx.db, 'R2');
    const c = svc.create(
      adminBoth,
      base({ branchIds: [ser, car], retailNetworkId: net, economicGroupId: grp }),
    );
    fx.app.sqlite.exec(
      `update branches set active = 0 where code = 'CAR';
       update retail_networks set active = 0 where code in ('R1', 'R2');
       update economic_groups set active = 0 where code = 'G1';`,
    );
    expect(svc.get(adminBoth, c.id).id).toBe(c.id);
    expect(svc.list(adminCar).items).toHaveLength(1);
    // editar o nome segue ok para quem tem todas as filiais (referências inalteradas não são revalidadas)
    expect(svc.update(adminBoth, c.id, 1, { legalName: 'Novo Nome' }).version).toBe(2);
    // trocar para rede inativa ou adicionar filial inativa: 400
    expect(codeOf(() => svc.update(adminBoth, c.id, 2, { retailNetworkId: net2 }))).toBe('validation_error');
    const third = seedBranch(fx.db, 'OFF', { active: false });
    expect(
      codeOf(() => svc.update(adminOf('SER', 'CAR', 'OFF'), c.id, 2, { branchIds: [ser, car, third] })),
    ).toBe('validation_error');
  });
});

describe('clientes: busca e escopo', () => {
  it('cursor e q nunca devolvem registro fora do escopo', () => {
    const cnpjs = [CNPJ_A, CNPJ_B, CNPJ_C, CNPJ_D];
    const owners = [ser, car, ser, car];
    cnpjs.forEach((cnpj, i) =>
      svc.create(
        owners[i] === ser ? adminSer : adminCar,
        base({ cnpj, legalName: `Cliente ${i}`, branchIds: [owners[i]!] }),
      ),
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = svc.list(adminSer, { limit: 1, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((i) => i.cnpj));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual([CNPJ_A, CNPJ_C]);
    // q pelo CNPJ ou pela razão de cliente que só existe na outra filial: nada
    expect(svc.list(adminSer, { q: CNPJ_B }).items).toEqual([]);
    expect(svc.list(adminSer, { q: '11.444.777' }).items).toEqual([]);
    expect(svc.list(adminSer, { q: 'Cliente 1' }).items).toEqual([]);
    expect(svc.list(adminSer, { q: 'Cliente 0' }).items).toHaveLength(1);
  });

  it("q='%' e q='_' não casam tudo", () => {
    svc.create(adminSer, base({ legalName: 'Alfa' }));
    svc.create(adminSer, base({ cnpj: CNPJ_B, legalName: 'Beta' }));
    expect(svc.list(adminSer, { q: '%' }).items).toHaveLength(0);
    expect(svc.list(adminSer, { q: '_' }).items).toHaveLength(0);
    expect(svc.list(adminSer, { q: 'Al_a' }).items).toHaveLength(0);
    svc.create(adminSer, base({ cnpj: CNPJ_C, legalName: '100% Genérico_' }));
    expect(svc.list(adminSer, { q: '100%' }).items).toHaveLength(1);
    expect(svc.list(adminSer, { q: 'gener_co' }).items).toHaveLength(0);
  });

  it('busca é insensível a acento e caixa', () => {
    svc.create(adminSer, base({ legalName: 'DROGARIA SÃO JOSÉ', tradeName: 'Farmácia Popular' }));
    svc.create(adminSer, base({ cnpj: CNPJ_B, legalName: 'Outra' }));
    expect(svc.list(adminSer, { q: 'sao' }).items.map((i) => i.legalName)).toEqual(['DROGARIA SÃO JOSÉ']);
    expect(svc.list(adminSer, { q: 'são josé' }).items).toHaveLength(1);
    expect(svc.list(adminSer, { q: 'farmacia' }).items).toHaveLength(1);
    expect(svc.list(adminSer, { q: 'FARMÁCIA  popular' }).items).toHaveLength(1);
    // a chave acompanha o PATCH
    const id = svc.list(adminSer, { q: 'sao' }).items[0]!.id;
    svc.update(adminSer, id, 1, { legalName: 'Drogaria Ímpar', tradeName: null });
    expect(svc.list(adminSer, { q: 'sao' }).items).toHaveLength(0);
    expect(svc.list(adminSer, { q: 'impar' }).items).toHaveLength(1);
  });

  it('CNPJ alfanumérico: q em minúsculas ou mascarada acha; recriar em outra caixa é customer_exists', () => {
    const c = svc.create(adminSer, base({ cnpj: '12.abc.345/01de-35' }));
    expect(c.cnpj).toBe('12ABC34501DE35');
    for (const q of ['12abc345', '12.abc.345/01de-35', '12.ABC.345/01DE-35', '01de35']) {
      expect(
        svc.list(adminSer, { q }).items.map((i) => i.id),
        q,
      ).toEqual([c.id]);
    }
    expect(codeOf(() => svc.create(adminSer, base({ cnpj: '12ABC34501DE35' })))).toBe('customer_exists');
    expect(codeOf(() => svc.create(adminSer, base({ cnpj: '12abc34501de35' })))).toBe('customer_exists');
  });
});

describe('clientes: atomicidade', () => {
  it('PATCH desfaz tudo (inclusive vínculos) quando falha depois de mudar os vínculos', () => {
    const c = svc.create(adminBoth, base({ branchIds: [ser] }));
    fx.app.sqlite.exec(
      `create trigger boom before update on customers
       begin select raise(abort, 'falha simulada'); end`,
    );
    expect(() => svc.update(adminBoth, c.id, 1, { legalName: 'X', branchIds: [car] })).toThrow();
    expect(linkRows(c.id)).toEqual([{ branch_id: ser, active: 1 }]);
    expect(globalRow(c.id).version).toBe(1);
  });

  it('deactivate desfaz os vínculos quando a escrita do registro falha', () => {
    const c = svc.create(adminBoth, base({ branchIds: [ser, car] }));
    fx.app.sqlite.exec(
      `create trigger boom before update on customers
       begin select raise(abort, 'falha simulada'); end`,
    );
    expect(() => svc.deactivate(adminBoth, c.id, 1)).toThrow();
    expect(linkRows(c.id).every((l) => l.active === 1)).toBe(true);
  });
});
