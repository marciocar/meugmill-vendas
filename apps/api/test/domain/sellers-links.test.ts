import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSellerService, type SellerService } from '../../src/domain/sellers/service.js';
import { adminOf, codeOf, makeFixture, seedBranch, type Fixture } from '../helpers/seed.js';

let fx: Fixture;
let svc: SellerService;
let ser: number;
let car: number;
const adminSer = adminOf('SER');
const adminCar = adminOf('CAR');
const adminBoth = adminOf('SER', 'CAR');

const linkRows = (sellerId: number) =>
  fx.app.sqlite
    .prepare('select branch_id, active from seller_branches where seller_id = ? order by branch_id')
    .all(sellerId) as { branch_id: number; active: number }[];
const globalRow = (id: number) =>
  fx.app.sqlite.prepare('select active, version from sellers where id = ?').get(id) as {
    active: number;
    version: number;
  };

beforeEach(async () => {
  fx = await makeFixture();
  svc = createSellerService(fx.db);
  ser = seedBranch(fx.db, 'SER');
  car = seedBranch(fx.db, 'CAR');
});
afterEach(async () => {
  await fx.app.close();
});

describe('vendedores: link por código e ativo por vínculo', () => {
  it('cenário do achado: A liga o vendedor de B, lê, inativa só o vínculo e B não é afetado', () => {
    const s = svc.create(adminCar, { code: 'V1', name: 'Maria Souza', branchIds: [car] });
    expect(codeOf(() => svc.get(adminSer, s.id))).toBe('not_found');
    const linked = svc.linkSellerToBranchByCode(adminSer, 'V1', ser);
    expect(linked).toEqual({ id: s.id, version: 2 });
    expect(svc.get(adminSer, s.id).name).toBe('Maria Souza');

    const off = svc.deactivate(adminSer, s.id, 2);
    expect(off).toMatchObject({ active: false, version: 3 });
    expect(globalRow(s.id).active).toBe(1);
    expect(linkRows(s.id)).toEqual([
      { branch_id: ser, active: 0 },
      { branch_id: car, active: 1 },
    ]);
    expect(svc.get(adminCar, s.id)).toMatchObject({ active: true, version: 3 });
    expect(svc.get(adminCar, s.id).branches).toEqual([
      { id: car, code: 'CAR', name: 'Filial CAR', active: true },
    ]);
    expect(svc.list(adminSer, { active: true }).items).toHaveLength(0);
    expect(svc.list(adminSer, { active: false }).items).toHaveLength(1);
    expect(svc.list(adminCar, { active: true }).items).toHaveLength(1);
  });

  it('link é idempotente, valida escopo, existência e filial ativa', () => {
    const s = svc.create(adminCar, { code: 'V1', name: 'X', branchIds: [car] });
    expect(svc.linkSellerToBranchByCode(adminSer, 'V1', ser).version).toBe(2);
    expect(svc.linkSellerToBranchByCode(adminSer, 'V1', ser)).toEqual({ id: s.id, version: 2 });
    expect(codeOf(() => svc.linkSellerToBranchByCode(adminSer, 'V1', car))).toBe('forbidden');
    expect(codeOf(() => svc.linkSellerToBranchByCode(adminSer, 'NAO', ser))).toBe('not_found');
    expect(codeOf(() => svc.linkSellerToBranchByCode(adminOf('X'), 'V1', 1))).toBe('forbidden');
    const off = seedBranch(fx.db, 'OFF', { active: false });
    expect(codeOf(() => svc.linkSellerToBranchByCode(adminOf('OFF'), 'V1', off))).toBe('validation_error');
    expect(codeOf(() => svc.linkSellerToBranchByCode({ ...adminSer, roles: [] }, 'V1', ser))).toBe(
      'forbidden',
    );
  });

  it('PATCH de nome exige todas as filiais; só branchIds é permitido a admin parcial', () => {
    const s = svc.create(adminCar, { code: 'V1', name: 'Maria', branchIds: [car] });
    svc.linkSellerToBranchByCode(adminSer, 'V1', ser); // v2
    expect(codeOf(() => svc.update(adminSer, s.id, 2, { name: 'Outro' }))).toBe('forbidden');
    expect(globalRow(s.id).version).toBe(2);
    expect(svc.update(adminSer, s.id, 2, { name: 'Maria' }).version).toBe(3); // mesmo valor
    expect(svc.update(adminBoth, s.id, 3, { name: 'Outro' })).toMatchObject({ name: 'Outro', version: 4 });
  });

  it('admin com todas as filiais: deactivate/reactivate mexem só nos vínculos; global segue ativo', () => {
    const s = svc.create(adminBoth, { code: 'V1', name: 'X', branchIds: [ser, car] });
    expect(svc.deactivate(adminBoth, s.id, 1)).toMatchObject({ active: false, version: 2 });
    expect(globalRow(s.id).active).toBe(1);
    expect(linkRows(s.id).every((l) => l.active === 0)).toBe(true);
    expect(svc.reactivate(adminBoth, s.id, 2)).toMatchObject({ active: true, version: 3 });
    expect(globalRow(s.id).active).toBe(1);
  });

  it('deactivate-global/reactivate-global: cobertura total, idempotência, 403, 428, 409, 404', () => {
    const s = svc.create(adminBoth, { code: 'V1', name: 'X', branchIds: [ser, car] });
    expect(codeOf(() => svc.deactivateGlobal(adminSer, s.id, 1))).toBe('forbidden');
    expect(globalRow(s.id)).toEqual({ active: 1, version: 1 });
    expect(codeOf(() => svc.deactivateGlobal(adminBoth, s.id, undefined))).toBe('precondition_required');

    const off = svc.deactivateGlobal(adminBoth, s.id, 1);
    expect(off).toMatchObject({ active: false, version: 2 });
    expect(globalRow(s.id)).toEqual({ active: 0, version: 2 });
    expect(linkRows(s.id).every((l) => l.active === 1)).toBe(true);
    for (const who of [adminSer, adminCar, adminBoth]) {
      expect(svc.list(who, { active: true }).items).toHaveLength(0);
    }
    expect(svc.deactivateGlobal(adminBoth, s.id, 1)).toMatchObject({ version: 2 }); // idempotente

    expect(codeOf(() => svc.reactivateGlobal(adminSer, s.id, 2))).toBe('forbidden');
    expect(codeOf(() => svc.reactivateGlobal(adminBoth, s.id, undefined))).toBe('precondition_required');
    expect(codeOf(() => svc.reactivateGlobal(adminBoth, s.id, 1))).toBe('version_conflict');
    expect(svc.reactivateGlobal(adminBoth, s.id, 2)).toMatchObject({ active: true, version: 3 });
    expect(svc.list(adminSer, { active: true }).items).toHaveLength(1);

    const other = svc.create(adminCar, { code: 'V2', name: 'Y', branchIds: [car] });
    expect(codeOf(() => svc.deactivateGlobal(adminSer, other.id, 1))).toBe('not_found');
    expect(codeOf(() => svc.reactivateGlobal(adminSer, other.id, 1))).toBe('not_found');
    expect(globalRow(other.id)).toEqual({ active: 1, version: 1 });
  });

  it('fora do escopo: 404 sem mudar a versão; repetir por vínculo é idempotente', () => {
    const s = svc.create(adminCar, { code: 'V1', name: 'X', branchIds: [car] });
    expect(codeOf(() => svc.deactivate(adminSer, s.id, 1))).toBe('not_found');
    expect(codeOf(() => svc.reactivate(adminSer, s.id, 1))).toBe('not_found');
    expect(globalRow(s.id)).toEqual({ active: 1, version: 1 });
    const two = svc.create(adminBoth, { code: 'V2', name: 'Y', branchIds: [ser, car] });
    const off = svc.deactivate(adminSer, two.id, 1);
    expect(svc.deactivate(adminSer, two.id, 1)).toEqual(off);
    expect(globalRow(two.id).version).toBe(2);
  });

  it('link incrementa a versão; PATCH com versão antiga e dois PATCH com a mesma versão: 409', () => {
    const s = svc.create(adminBoth, { code: 'V1', name: 'X', branchIds: [ser] });
    svc.linkSellerToBranchByCode(adminCar, 'V1', car);
    expect(codeOf(() => svc.update(adminBoth, s.id, 1, { name: 'Y' }))).toBe('version_conflict');
    svc.update(adminBoth, s.id, 2, { name: 'Y' });
    expect(codeOf(() => svc.update(adminBoth, s.id, 2, { name: 'Z' }))).toBe('version_conflict');
  });

  it('PATCH de branchIds parcial preserva o vínculo oculto (conferido no banco)', () => {
    const third = seedBranch(fx.db, 'TER');
    const s = svc.create(adminOf('SER', 'CAR', 'TER'), {
      code: 'V1',
      name: 'X',
      branchIds: [ser, car, third],
    });
    const u = svc.update(adminOf('SER', 'TER'), s.id, 1, { branchIds: [third] });
    expect(u.branches.map((b) => b.code)).toEqual(['TER']);
    expect(linkRows(s.id).map((l) => l.branch_id)).toEqual([car, third]);
  });

  it('PATCH desfaz tudo quando falha depois de mudar os vínculos', () => {
    const s = svc.create(adminBoth, { code: 'V1', name: 'X', branchIds: [ser] });
    fx.app.sqlite.exec(
      `create trigger boom before update on sellers
       begin select raise(abort, 'falha simulada'); end`,
    );
    expect(() => svc.update(adminBoth, s.id, 1, { name: 'Y', branchIds: [car] })).toThrow();
    expect(linkRows(s.id)).toEqual([{ branch_id: ser, active: 1 }]);
    expect(globalRow(s.id).version).toBe(1);
  });
});

describe('vendedores: busca e escopo', () => {
  it('cursor e q nunca devolvem vendedor fora do escopo', () => {
    ['V1', 'V2', 'V3', 'V4'].forEach((code, i) =>
      svc.create(i % 2 === 0 ? adminSer : adminCar, {
        code,
        name: `Vendedor ${code}`,
        branchIds: [i % 2 === 0 ? ser : car],
      }),
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = svc.list(adminSer, { limit: 1, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((i) => i.code));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(['V1', 'V3']);
    expect(svc.list(adminSer, { q: 'V2' }).items).toEqual([]);
    expect(svc.list(adminSer, { q: 'Vendedor V4' }).items).toEqual([]);
  });

  it("q='%' e q='_' não casam tudo", () => {
    svc.create(adminSer, { code: 'V1', name: 'Alfa', branchIds: [ser] });
    svc.create(adminSer, { code: 'V2', name: 'Beta', branchIds: [ser] });
    expect(svc.list(adminSer, { q: '%' }).items).toHaveLength(0);
    expect(svc.list(adminSer, { q: '_' }).items).toHaveLength(0);
  });

  it('busca por nome é insensível a acento e caixa', () => {
    svc.create(adminSer, { code: 'V1', name: 'José  da Conceição', branchIds: [ser] });
    expect(svc.list(adminSer, { q: 'jose' }).items).toHaveLength(1);
    expect(svc.list(adminSer, { q: 'CONCEICAO' }).items).toHaveLength(1);
    expect(svc.list(adminSer, { q: 'v1' }).items).toHaveLength(1);
  });
});
