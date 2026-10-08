import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCustomerService, type CustomerService } from '../../src/domain/customers/service.js';
import type { CreateCustomerInput } from '../../src/domain/customers/schemas.js';
import {
  CNPJ_A,
  CNPJ_B,
  CNPJ_C,
  ES,
  SAO_PAULO,
  SERRA,
  SP,
  VITORIA,
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
  neighborhood: 'Jardim  Câmburi',
  branchIds: [ser],
  ...over,
});

beforeEach(async () => {
  fx = await makeFixture();
  svc = createCustomerService(fx.db);
  ser = seedBranch(fx.db, 'SER');
  car = seedBranch(fx.db, 'CAR');
});
afterEach(async () => {
  await fx.app.close();
});

describe('clientes: criação e validação', () => {
  it('cria, normaliza e deriva UF e chave do bairro', () => {
    const c = svc.create(adminSer, base({ cnpj: '11.222.333/0001-81', tradeName: '  Central ' }));
    expect(c).toMatchObject({
      cnpj: CNPJ_A,
      legalName: 'Farmácia Central Ltda',
      tradeName: 'Central',
      stateCode: ES,
      municipalityCode: SERRA,
      neighborhood: 'Jardim Câmburi',
      neighborhoodKey: 'JARDIM CAMBURI',
      retailNetworkId: null,
      economicGroupId: null,
      active: true,
      version: 1,
    });
    expect(c.branches).toEqual([{ id: ser, code: 'SER', name: 'Filial SER' }]);
  });

  it('CNPJ inválido, sem filial ou campo extra é validation_error', () => {
    expect(codeOf(() => svc.create(adminSer, base({ cnpj: '11222333000182' })))).toBe('validation_error');
    expect(codeOf(() => svc.create(adminSer, base({ cnpj: '11111111111111' })))).toBe('validation_error');
    expect(codeOf(() => svc.create(adminSer, base({ branchIds: [] })))).toBe('validation_error');
    expect(codeOf(() => svc.create(adminSer, { ...base(), email: 'a@b.c' } as never))).toBe(
      'validation_error',
    );
    expect(codeOf(() => svc.create(adminSer, base({ neighborhood: '   ' })))).toBe('validation_error');
  });

  it('coerência UF × município', () => {
    expect(svc.create(adminSer, base({ stateCode: ES })).stateCode).toBe(ES);
    expect(codeOf(() => svc.create(adminSer, base({ cnpj: CNPJ_B, stateCode: SP })))).toBe(
      'validation_error',
    );
    expect(codeOf(() => svc.create(adminSer, base({ cnpj: CNPJ_B, municipalityCode: 1 })))).toBe(
      'validation_error',
    );
    const sp = svc.create(adminSer, base({ cnpj: CNPJ_B, municipalityCode: SAO_PAULO }));
    expect(sp.stateCode).toBe(SP);
  });

  it('rede e grupo inexistentes ou inativos são validation_error', () => {
    expect(codeOf(() => svc.create(adminSer, base({ retailNetworkId: 999 })))).toBe('validation_error');
    expect(codeOf(() => svc.create(adminSer, base({ economicGroupId: 999 })))).toBe('validation_error');
    const off = seedRetailNetwork(fx.db, 'R0', false);
    expect(codeOf(() => svc.create(adminSer, base({ retailNetworkId: off })))).toBe('validation_error');
    const n = seedRetailNetwork(fx.db, 'R1');
    const g = seedEconomicGroup(fx.db, 'G1');
    const c = svc.create(adminSer, base({ retailNetworkId: n, economicGroupId: g }));
    expect(c).toMatchObject({ retailNetworkId: n, economicGroupId: g });
  });

  it('transação: falha ao gravar vínculos não deixa cliente órfão', () => {
    fx.app.sqlite.exec(
      `create trigger boom before insert on customer_branches
       begin select raise(abort, 'falha simulada'); end`,
    );
    expect(() => svc.create(adminSer, base())).toThrow();
    const n = fx.app.sqlite.prepare('select count(*) as n from customers').get() as { n: number };
    expect(n.n).toBe(0);
  });
});

describe('clientes: autorização e escopo', () => {
  it('não-admin não escreve (forbidden)', () => {
    const reader = readerOf('SER');
    expect(codeOf(() => svc.create(reader, base()))).toBe('forbidden');
    const c = svc.create(adminSer, base());
    expect(codeOf(() => svc.update(reader, c.id, 1, { legalName: 'X' }))).toBe('forbidden');
    expect(codeOf(() => svc.deactivate(reader, c.id, 1))).toBe('forbidden');
    expect(codeOf(() => svc.linkCustomerToBranchByCnpj(reader, CNPJ_A, ser))).toBe('forbidden');
    // mas lê o que está no escopo
    expect(svc.get(reader, c.id).id).toBe(c.id);
  });

  it('criar com filial fora do token é forbidden e não grava nada', () => {
    expect(codeOf(() => svc.create(adminSer, base({ branchIds: [ser, car] })))).toBe('forbidden');
    expect(codeOf(() => svc.create(adminSer, base({ branchIds: [999] })))).toBe('forbidden');
    expect(svc.list(adminBoth).items).toHaveLength(0);
  });

  it('cliente só da filial B é not_found para o ator da filial A', () => {
    const b = svc.create(adminCar, base({ branchIds: [car] }));
    expect(codeOf(() => svc.get(adminSer, b.id))).toBe('not_found');
    expect(codeOf(() => svc.update(adminSer, b.id, 1, { legalName: 'X' }))).toBe('not_found');
    expect(codeOf(() => svc.deactivate(adminSer, b.id, 1))).toBe('not_found');
    expect(codeOf(() => svc.reactivate(adminSer, b.id, 1))).toBe('not_found');
    expect(svc.list(adminSer).items).toEqual([]);
    expect(svc.list(adminCar).items).toHaveLength(1);
    expect(svc.list(readerOf()).items).toEqual([]);
  });

  it('resposta traz só as filiais do escopo do ator (não vaza a outra filial)', () => {
    const c = svc.create(adminBoth, base({ branchIds: [ser, car] }));
    expect(c.branches.map((b) => b.code)).toEqual(['CAR', 'SER']);
    expect(svc.get(adminSer, c.id).branches.map((b) => b.code)).toEqual(['SER']);
    expect(svc.list(adminCar).items[0]!.branches.map((b) => b.code)).toEqual(['CAR']);
  });

  it('busca por CNPJ (com máscara), razão social e nome fantasia', () => {
    svc.create(adminSer, base({ tradeName: 'Drogaria Azul' }));
    svc.create(adminSer, base({ cnpj: CNPJ_B, legalName: 'Outra SA' }));
    expect(svc.list(adminSer, { q: '11.222.333' }).items).toHaveLength(1);
    expect(svc.list(adminSer, { q: 'azul' }).items).toHaveLength(1);
    expect(svc.list(adminSer, { q: 'outra' }).items).toHaveLength(1);
    expect(svc.list(adminSer, { q: 'inexistente' }).items).toHaveLength(0);
  });

  it('pagina por cursor', () => {
    for (const cnpj of [CNPJ_A, CNPJ_B, CNPJ_C]) svc.create(adminSer, base({ cnpj }));
    const p1 = svc.list(adminSer, { limit: 2 });
    expect(p1.items).toHaveLength(2);
    const p2 = svc.list(adminSer, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });
});

describe('clientes: unicidade e vínculo por CNPJ', () => {
  it('CNPJ existente (inclusive inativo) responde customer_exists', () => {
    const c = svc.create(adminSer, base());
    expect(codeOf(() => svc.create(adminCar, base({ branchIds: [car] })))).toBe('customer_exists');
    svc.deactivate(adminSer, c.id, 1);
    expect(codeOf(() => svc.create(adminSer, base()))).toBe('customer_exists');
  });

  it('link por CNPJ liga à filial do admin, é idempotente e só incrementa uma vez', () => {
    const c = svc.create(adminSer, base());
    expect(codeOf(() => svc.get(adminCar, c.id))).toBe('not_found');
    const linked = svc.linkCustomerToBranchByCnpj(adminCar, '11.222.333/0001-81', car);
    expect(linked.id).toBe(c.id);
    expect(linked.version).toBe(2);
    expect(linked.branches.map((b) => b.code)).toEqual(['CAR']);
    const again = svc.linkCustomerToBranchByCnpj(adminCar, CNPJ_A, car);
    expect(again).toEqual(linked);
    expect(svc.get(adminBoth, c.id).branches.map((b) => b.code)).toEqual(['CAR', 'SER']);
  });

  it('link: filial fora do token é forbidden; CNPJ desconhecido é not_found; inválido é validation_error', () => {
    svc.create(adminSer, base());
    expect(codeOf(() => svc.linkCustomerToBranchByCnpj(adminSer, CNPJ_A, car))).toBe('forbidden');
    expect(codeOf(() => svc.linkCustomerToBranchByCnpj(adminSer, CNPJ_B, ser))).toBe('not_found');
    expect(codeOf(() => svc.linkCustomerToBranchByCnpj(adminSer, '123', ser))).toBe('validation_error');
  });

  it('link a filial inativa é validation_error', () => {
    svc.create(adminSer, base());
    const off = seedBranch(fx.db, 'OFF', { active: false });
    expect(codeOf(() => svc.linkCustomerToBranchByCnpj(adminOf('OFF'), CNPJ_A, off))).toBe(
      'validation_error',
    );
  });
});

describe('clientes: atualização, versão e estado', () => {
  it('precondition_required, version_conflict e incremento de versão', () => {
    const c = svc.create(adminSer, base());
    expect(codeOf(() => svc.update(adminSer, c.id, undefined, { legalName: 'N' }))).toBe(
      'precondition_required',
    );
    expect(codeOf(() => svc.update(adminSer, c.id, 3, { legalName: 'N' }))).toBe('version_conflict');
    const u = svc.update(adminSer, c.id, 1, { legalName: ' Novo  Nome ', neighborhood: 'São  José' });
    expect(u).toMatchObject({
      legalName: 'Novo Nome',
      neighborhood: 'São José',
      neighborhoodKey: 'SAO JOSE',
      version: 2,
    });
    expect(codeOf(() => svc.update(adminSer, c.id, 1, { legalName: 'N' }))).toBe('version_conflict');
    expect(codeOf(() => svc.update(adminSer, c.id, 2, {}))).toBe('validation_error');
  });

  it('muda município e UF juntos; UF divergente é rejeitada; null limpa campos', () => {
    const n = seedRetailNetwork(fx.db, 'R1');
    const c = svc.create(adminSer, base({ tradeName: 'T', retailNetworkId: n }));
    expect(codeOf(() => svc.update(adminSer, c.id, 1, { municipalityCode: VITORIA, stateCode: SP }))).toBe(
      'validation_error',
    );
    expect(codeOf(() => svc.update(adminSer, c.id, 1, { stateCode: SP }))).toBe('validation_error');
    const u = svc.update(adminSer, c.id, 1, {
      municipalityCode: SAO_PAULO,
      tradeName: null,
      retailNetworkId: null,
    });
    expect(u).toMatchObject({
      municipalityCode: SAO_PAULO,
      stateCode: SP,
      tradeName: null,
      retailNetworkId: null,
    });
  });

  it('vínculos: conjunto desejado no escopo, preservando filiais ocultas', () => {
    const c = svc.create(adminBoth, base({ branchIds: [ser, car] }));
    // ator só de SER: pedir CAR (fora do token) é forbidden
    expect(codeOf(() => svc.update(adminSer, c.id, 1, { branchIds: [ser, car] }))).toBe('forbidden');
    // esvaziar o escopo dele mantém CAR (oculta) e o cliente some para ele
    const u = svc.update(adminSer, c.id, 1, { branchIds: [] });
    expect(u.branches).toEqual([]);
    expect(codeOf(() => svc.get(adminSer, c.id))).toBe('not_found');
    expect(svc.get(adminCar, c.id).branches.map((b) => b.code)).toEqual(['CAR']);
  });

  it('o cliente não pode ficar sem nenhuma filial', () => {
    const c = svc.create(adminSer, base());
    expect(codeOf(() => svc.update(adminSer, c.id, 1, { branchIds: [] }))).toBe('validation_error');
    expect(svc.get(adminSer, c.id).branches).toHaveLength(1);
  });

  it('adiciona e remove filiais do token', () => {
    const c = svc.create(adminBoth, base());
    const added = svc.update(adminBoth, c.id, 1, { branchIds: [ser, car] });
    expect(added.branches.map((b) => b.code)).toEqual(['CAR', 'SER']);
    const removed = svc.update(adminBoth, c.id, 2, { branchIds: [car] });
    expect(removed.branches.map((b) => b.code)).toEqual(['CAR']);
  });

  it('deactivate/reactivate idempotentes; update em inativo continua permitido', () => {
    const c = svc.create(adminSer, base());
    const off = svc.deactivate(adminSer, c.id, 1);
    expect(off).toMatchObject({ active: false, version: 2 });
    expect(svc.deactivate(adminSer, c.id, 2)).toEqual(off);
    expect(svc.list(adminSer, { active: true }).items).toHaveLength(0);
    expect(svc.list(adminSer, { active: false }).items).toHaveLength(1);
    expect(codeOf(() => svc.reactivate(adminSer, c.id, undefined))).toBe('precondition_required');
    const on = svc.reactivate(adminSer, c.id, 2);
    expect(on).toMatchObject({ active: true, version: 3, deactivatedAt: null });
    expect(svc.reactivate(adminSer, c.id, 3)).toEqual(on);
  });
});
