import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createEconomicGroupService,
  createProductSubgroupService,
  createRetailNetworkService,
  type CatalogService,
} from '../../src/domain/catalog/service.js';
import { decodeCursor } from '../../src/domain/shared/pagination.js';
import { adminOf, codeOf, makeFixture, readerOf, type Fixture } from '../helpers/seed.js';

let fx: Fixture;
let svc: CatalogService;
const admin = adminOf('SER');
const reader = readerOf('SER');

beforeEach(async () => {
  fx = await makeFixture();
  svc = createProductSubgroupService(fx.db);
});
afterEach(async () => {
  await fx.app.close();
});

describe('catálogo (subgrupos, redes, grupos)', () => {
  it('cria com trim e devolve versão 1 ativa; leitura aberta a qualquer ator', () => {
    const created = svc.create(admin, { code: ' SG1 ', name: '  Genéricos   Orais ' });
    expect(created).toMatchObject({ code: 'SG1', name: 'Genéricos Orais', active: true, version: 1 });
    expect(svc.get(readerOf(), created.id)).toEqual(created);
    expect(Object.keys(created)).not.toContain('createdBy');
  });

  it('só admin escreve (forbidden), inclusive deactivate', () => {
    expect(codeOf(() => svc.create(reader, { code: 'X', name: 'X' }))).toBe('forbidden');
    const c = svc.create(admin, { code: 'SG1', name: 'A' });
    expect(codeOf(() => svc.update(reader, c.id, 1, { name: 'B' }))).toBe('forbidden');
    expect(codeOf(() => svc.deactivate(reader, c.id, 1))).toBe('forbidden');
  });

  it('código único, mesmo com o registro inativo', () => {
    const c = svc.create(admin, { code: 'SG1', name: 'A' });
    svc.deactivate(admin, c.id, 1);
    expect(codeOf(() => svc.create(admin, { code: 'SG1', name: 'B' }))).toBe('conflict');
  });

  it('entrada inválida vira validation_error', () => {
    expect(codeOf(() => svc.create(admin, { code: '   ', name: 'A' }))).toBe('validation_error');
    expect(codeOf(() => svc.create(admin, { code: 'A B', name: 'A' }))).toBe('validation_error');
    expect(codeOf(() => svc.create(admin, { code: 'A', name: 'A', extra: 1 } as never))).toBe(
      'validation_error',
    );
    expect(codeOf(() => svc.create(admin, { code: 'A'.repeat(33), name: 'A' }))).toBe('validation_error');
  });

  it('update: precondition_required, version_conflict e sucesso incrementa', () => {
    const c = svc.create(admin, { code: 'SG1', name: 'A' });
    expect(codeOf(() => svc.update(admin, c.id, undefined, { name: 'B' }))).toBe('precondition_required');
    expect(codeOf(() => svc.update(admin, c.id, 7, { name: 'B' }))).toBe('version_conflict');
    const updated = svc.update(admin, c.id, 1, { name: 'B' });
    expect(updated).toMatchObject({ name: 'B', version: 2 });
    expect(codeOf(() => svc.update(admin, c.id, 1, { name: 'C' }))).toBe('version_conflict');
    expect(codeOf(() => svc.update(admin, 9999, 1, { name: 'C' }))).toBe('not_found');
  });

  it('deactivate/reactivate são idempotentes e só mudam a versão ao trocar de estado', () => {
    const c = svc.create(admin, { code: 'SG1', name: 'A' });
    const off = svc.deactivate(admin, c.id, 1);
    expect(off).toMatchObject({ active: false, version: 2 });
    expect(off.deactivatedAt).not.toBeNull();
    expect(svc.deactivate(admin, c.id, 2)).toEqual(off);
    expect(codeOf(() => svc.deactivate(admin, c.id, undefined))).toBe('precondition_required');
    const on = svc.reactivate(admin, c.id, 2);
    expect(on).toMatchObject({ active: true, version: 3, deactivatedAt: null });
    expect(svc.reactivate(admin, c.id, 3)).toEqual(on);
    expect(codeOf(() => svc.deactivate(admin, c.id, 1))).toBe('version_conflict');
  });

  it('lista com filtro active, busca por código/nome e paginação por cursor', () => {
    for (let i = 1; i <= 5; i++) svc.create(admin, { code: `S${i}`, name: `Item ${i}` });
    svc.deactivate(admin, svc.list(admin).items[0]!.id, 1);

    const page1 = svc.list(reader, { limit: 2 });
    expect(page1.items.map((i) => i.code)).toEqual(['S1', 'S2']);
    expect(decodeCursor(page1.nextCursor ?? undefined)).toBe(page1.items[1]!.id);
    const page2 = svc.list(reader, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((i) => i.code)).toEqual(['S3', 'S4']);
    const page3 = svc.list(reader, { limit: 2, cursor: page2.nextCursor! });
    expect(page3.items.map((i) => i.code)).toEqual(['S5']);
    expect(page3.nextCursor).toBeNull();

    expect(svc.list(reader, { active: false }).items.map((i) => i.code)).toEqual(['S1']);
    expect(svc.list(reader, { active: true }).items).toHaveLength(4);
    expect(svc.list(reader, { q: 'item 3' }).items.map((i) => i.code)).toEqual(['S3']);
    expect(svc.list(reader, { q: 's5' }).items).toHaveLength(1);
    expect(svc.list(reader, { q: '%' }).items).toHaveLength(0); // % é literal
    expect(codeOf(() => svc.list(reader, { limit: 500 }))).toBe('validation_error');
  });

  it('redes e grupos econômicos usam o mesmo serviço sobre tabelas próprias', () => {
    const networks = createRetailNetworkService(fx.db);
    const groups = createEconomicGroupService(fx.db);
    networks.create(admin, { code: 'R1', name: 'Rede' });
    groups.create(admin, { code: 'R1', name: 'Grupo' });
    expect(networks.list(reader).items[0]!.name).toBe('Rede');
    expect(groups.list(reader).items[0]!.name).toBe('Grupo');
    expect(svc.list(reader).items).toHaveLength(0);
  });
});
