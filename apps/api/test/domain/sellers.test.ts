import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSellerService, type SellerService } from '../../src/domain/sellers/service.js';
import { adminOf, codeOf, makeFixture, readerOf, seedBranch, type Fixture } from '../helpers/seed.js';

let fx: Fixture;
let svc: SellerService;
let ser: number;
let car: number;
const adminSer = adminOf('SER');
const adminCar = adminOf('CAR');
const adminBoth = adminOf('SER', 'CAR');

beforeEach(async () => {
  fx = await makeFixture();
  svc = createSellerService(fx.db);
  ser = seedBranch(fx.db, 'SER');
  car = seedBranch(fx.db, 'CAR');
});
afterEach(async () => {
  await fx.app.close();
});

describe('vendedores', () => {
  it('cria só com código, nome e filiais; rejeita campos pessoais extras', () => {
    const s = svc.create(adminSer, { code: ' V1 ', name: ' Maria  Silva ', branchIds: [ser] });
    expect(s).toMatchObject({ code: 'V1', name: 'Maria Silva', active: true, version: 1 });
    expect(s.branches).toEqual([{ id: ser, code: 'SER', name: 'Filial SER' }]);
    expect(
      codeOf(() =>
        svc.create(adminSer, { code: 'V2', name: 'X', branchIds: [ser], email: 'a@b.c' } as never),
      ),
    ).toBe('validation_error');
    expect(codeOf(() => svc.create(adminSer, { code: 'V2', name: 'X', branchIds: [] }))).toBe(
      'validation_error',
    );
  });

  it('não-admin e filial fora do token: forbidden', () => {
    expect(codeOf(() => svc.create(readerOf('SER'), { code: 'V1', name: 'X', branchIds: [ser] }))).toBe(
      'forbidden',
    );
    expect(codeOf(() => svc.create(adminSer, { code: 'V1', name: 'X', branchIds: [car] }))).toBe('forbidden');
  });

  it('código único mesmo inativo', () => {
    const s = svc.create(adminSer, { code: 'V1', name: 'X', branchIds: [ser] });
    svc.deactivate(adminSer, s.id, 1);
    expect(codeOf(() => svc.create(adminSer, { code: 'V1', name: 'Y', branchIds: [ser] }))).toBe('conflict');
  });

  it('escopo por vínculo: vendedor só da filial B é not_found para A', () => {
    const s = svc.create(adminCar, { code: 'V1', name: 'X', branchIds: [car] });
    expect(codeOf(() => svc.get(adminSer, s.id))).toBe('not_found');
    expect(codeOf(() => svc.update(adminSer, s.id, 1, { name: 'Z' }))).toBe('not_found');
    expect(svc.list(adminSer).items).toEqual([]);
    expect(svc.list(adminCar).items).toHaveLength(1);
  });

  it('vendedor em duas filiais aparece para ambas, sem vazar a outra filial', () => {
    const s = svc.create(adminBoth, { code: 'V1', name: 'X', branchIds: [ser, car] });
    expect(svc.get(adminSer, s.id).branches.map((b) => b.code)).toEqual(['SER']);
    expect(svc.get(adminCar, s.id).branches.map((b) => b.code)).toEqual(['CAR']);
  });

  it('update: versão, nome e vínculos', () => {
    const s = svc.create(adminBoth, { code: 'V1', name: 'X', branchIds: [ser] });
    expect(codeOf(() => svc.update(adminBoth, s.id, undefined, { name: 'Y' }))).toBe('precondition_required');
    expect(codeOf(() => svc.update(adminBoth, s.id, 9, { name: 'Y' }))).toBe('version_conflict');
    const u = svc.update(adminBoth, s.id, 1, { name: 'Y', branchIds: [ser, car] });
    expect(u).toMatchObject({ name: 'Y', version: 2 });
    expect(u.branches).toHaveLength(2);
    expect(codeOf(() => svc.update(adminBoth, s.id, 2, { branchIds: [] }))).toBe('validation_error');
    expect(codeOf(() => svc.update(adminSer, s.id, 2, { branchIds: [ser, car] }))).toBe('forbidden');
  });

  it('deactivate/reactivate idempotentes e busca por nome', () => {
    const s = svc.create(adminSer, { code: 'V1', name: 'Maria', branchIds: [ser] });
    const off = svc.deactivate(adminSer, s.id, 1);
    expect(svc.deactivate(adminSer, s.id, 2)).toEqual(off);
    expect(svc.reactivate(adminSer, s.id, 2)).toMatchObject({ active: true, version: 3 });
    expect(svc.list(adminSer, { q: 'mar' }).items).toHaveLength(1);
    expect(svc.list(adminSer, { q: 'zzz' }).items).toHaveLength(0);
  });
});
