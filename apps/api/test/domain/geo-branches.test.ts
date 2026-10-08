import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBranchService, type BranchService } from '../../src/domain/branches/service.js';
import { createGeoService, type GeoService } from '../../src/domain/geo/service.js';
import {
  ES,
  SAO_PAULO,
  SERRA,
  VITORIA,
  adminOf,
  codeOf,
  makeFixture,
  readerOf,
  seedBranch,
  type Fixture,
} from '../helpers/seed.js';

let fx: Fixture;

beforeEach(async () => {
  fx = await makeFixture();
});
afterEach(async () => {
  await fx.app.close();
});

describe('geo', () => {
  let geo: GeoService;
  beforeEach(() => {
    geo = createGeoService(fx.db);
  });

  it('lista as 27 UFs ordenadas', () => {
    const states = geo.listStates(readerOf());
    expect(states).toHaveLength(27);
    expect(states[0]!.uf).toBe('AC');
    expect(states.find((s) => s.uf === 'ES')).toMatchObject({ ibgeCode: ES });
  });

  it('municípios por UF, busca sem acento e sem caixa', () => {
    const es = geo.listMunicipalities(readerOf(), { uf: 'es', limit: 200 });
    expect(es.items.length).toBe(78);
    expect(es.items.every((m) => m.uf === 'ES')).toBe(true);
    const found = geo.listMunicipalities(readerOf(), { uf: 'ES', q: 'vitoria' });
    expect(found.items.map((m) => m.ibgeCode)).toContain(VITORIA);
    const accented = geo.listMunicipalities(readerOf(), { q: 'são paulo', uf: 'SP' });
    expect(accented.items.map((m) => m.ibgeCode)).toContain(SAO_PAULO);
  });

  it('pagina por cursor sem repetir nem pular', () => {
    const seen: number[] = [];
    let cursor: string | undefined;
    do {
      const page = geo.listMunicipalities(readerOf(), { uf: 'ES', limit: 30, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((m) => m.ibgeCode));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(78);
    expect(new Set(seen).size).toBe(78);
  });

  it('UF desconhecida devolve vazio; parâmetro malformado é validation_error', () => {
    expect(geo.listMunicipalities(readerOf(), { uf: 'ZZ' }).items).toEqual([]);
    expect(codeOf(() => geo.listMunicipalities(readerOf(), { uf: 'ESP' }))).toBe('validation_error');
  });
});

describe('filiais', () => {
  let svc: BranchService;
  const admin = adminOf('SER', 'VIT');
  beforeEach(() => {
    svc = createBranchService(fx.db);
  });

  it('cria filial cujo código está no token', () => {
    const b = svc.create(admin, { code: 'SER', name: ' Serra ', municipalityCode: SERRA });
    expect(b).toMatchObject({ code: 'SER', name: 'Serra', municipalityCode: SERRA, version: 1 });
  });

  it('criar filial fora do token é forbidden; não-admin é forbidden', () => {
    expect(codeOf(() => svc.create(admin, { code: 'XXX', name: 'X', municipalityCode: SERRA }))).toBe(
      'forbidden',
    );
    expect(
      codeOf(() => svc.create(readerOf('SER'), { code: 'SER', name: 'X', municipalityCode: SERRA })),
    ).toBe('forbidden');
  });

  it('município inexistente é validation_error; código repetido (mesmo inativo) é conflict', () => {
    expect(codeOf(() => svc.create(admin, { code: 'SER', name: 'S', municipalityCode: 1 }))).toBe(
      'validation_error',
    );
    const b = svc.create(admin, { code: 'SER', name: 'S', municipalityCode: SERRA });
    svc.deactivate(admin, b.id, 1);
    expect(codeOf(() => svc.create(admin, { code: 'SER', name: 'S', municipalityCode: SERRA }))).toBe(
      'conflict',
    );
  });

  it('só enxerga filiais do token; fora do escopo é not_found (inclusive escrita)', () => {
    const own = seedBranch(fx.db, 'SER');
    const other = seedBranch(fx.db, 'CAR');
    const a = adminOf('SER');
    expect(svc.list(a).items.map((b) => b.id)).toEqual([own]);
    expect(svc.get(a, own).code).toBe('SER');
    expect(codeOf(() => svc.get(a, other))).toBe('not_found');
    expect(codeOf(() => svc.update(a, other, 1, { name: 'Z' }))).toBe('not_found');
    expect(codeOf(() => svc.deactivate(a, other, 1))).toBe('not_found');
    expect(svc.list(adminOf()).items).toEqual([]);
  });

  it('escopo inclui filial inativa (o vínculo é por token, não por situação)', () => {
    const id = seedBranch(fx.db, 'OLD', { active: false });
    const a = adminOf('OLD');
    expect(svc.get(a, id).active).toBe(false);
    expect(svc.list(a, { active: false }).items).toHaveLength(1);
    expect(svc.reactivate(a, id, 1)).toMatchObject({ active: true, version: 2 });
  });

  it('update com versão, município e idempotência de inativar', () => {
    const b = svc.create(admin, { code: 'SER', name: 'S', municipalityCode: SERRA });
    expect(codeOf(() => svc.update(admin, b.id, undefined, { name: 'Z' }))).toBe('precondition_required');
    expect(codeOf(() => svc.update(admin, b.id, 5, { name: 'Z' }))).toBe('version_conflict');
    expect(codeOf(() => svc.update(admin, b.id, 1, { municipalityCode: 1 }))).toBe('validation_error');
    expect(codeOf(() => svc.update(admin, b.id, 1, {}))).toBe('validation_error');
    const u = svc.update(admin, b.id, 1, { municipalityCode: VITORIA });
    expect(u).toMatchObject({ municipalityCode: VITORIA, version: 2 });
    const off = svc.deactivate(admin, b.id, 2);
    expect(svc.deactivate(admin, b.id, 2)).toEqual(off);
  });
});
