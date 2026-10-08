import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeRoutesFixture, type RoutesFixture } from '../helpers/jwt.js';
import { v1Routes } from '../../src/routes/v1/index.js';
import { CNPJ_A, SERRA, seedBranch } from '../helpers/seed.js';

let t: RoutesFixture;
let idA: number;
let idB: number;

const ADMIN_A = { roles: ['admin'], branches: ['FA'] };
const ADMIN_B = { roles: ['admin'], branches: ['FB'] };
const ADMIN_AB = { roles: ['admin'], branches: ['FA', 'FB'] };
const LEGAL_NAME = 'Drogaria Bom Remédio Ltda';

beforeEach(async () => {
  t = await makeRoutesFixture(v1Routes);
  idA = seedBranch(t.db, 'FA');
  idB = seedBranch(t.db, 'FB');
});
afterEach(async () => {
  await t.app.close();
});

async function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  who: { roles: string[]; branches: string[] },
  opts: { payload?: Record<string, unknown>; ifMatch?: string } = {},
) {
  return t.app.inject({
    method,
    url,
    headers: await t.headers({ ...who, ...(opts.ifMatch ? { ifMatch: opts.ifMatch } : {}) }),
    ...(opts.payload ? { payload: opts.payload } : {}),
  });
}

describe('HTTP: cliente compartilhado entre filiais', () => {
  it('link sem dados, leitura posterior, inativação só do vínculo, 403 no dado compartilhado', async () => {
    const created = await call('POST', '/v1/customers', ADMIN_B, {
      payload: {
        cnpj: CNPJ_A,
        legalName: LEGAL_NAME,
        municipalityCode: SERRA,
        neighborhood: 'Centro',
        branchIds: [idB],
      },
    });
    const id = created.json().id as number;

    const link = await call('POST', `/v1/customers/by-cnpj/${CNPJ_A}/branches`, ADMIN_A, {
      payload: { branchId: idA },
    });
    expect(link.statusCode).toBe(200);
    expect(link.headers.etag).toBe('"2"');
    expect(link.json()).toEqual({ id, version: 2 });
    expect(link.body).not.toContain('Remédio');

    expect((await call('GET', `/v1/customers/${id}`, ADMIN_A)).statusCode).toBe(200);

    const patch = await call('PATCH', `/v1/customers/${id}`, ADMIN_A, {
      payload: { legalName: 'Outro' },
      ifMatch: '"2"',
    });
    expect(patch.statusCode).toBe(403);
    expect(patch.json()).toEqual({ error: 'forbidden' });

    const off = await call('POST', `/v1/customers/${id}/deactivate`, ADMIN_A, { ifMatch: '"2"' });
    expect(off.statusCode).toBe(200);
    expect(off.headers.etag).toBe('"3"');
    expect(off.json()).toMatchObject({
      active: false,
      branches: [{ id: idA, code: 'FA', name: 'Filial FA', active: false }],
    });
    const asB = await call('GET', `/v1/customers/${id}`, ADMIN_B);
    expect(asB.json()).toMatchObject({ active: true, branches: [{ code: 'FB', active: true }] });

    // admin com as duas filiais inativa globalmente
    const all = await call('POST', `/v1/customers/${id}/deactivate`, ADMIN_AB, { ifMatch: '"3"' });
    expect(all.statusCode).toBe(200);
    expect((await call('GET', `/v1/customers/${id}`, ADMIN_B)).json().active).toBe(false);
    const list = await call('GET', '/v1/customers?active=false', ADMIN_B);
    expect(list.json().items).toHaveLength(1);
  });

  it('deactivate fora do escopo: 404 e a versão não muda', async () => {
    const created = await call('POST', '/v1/customers', ADMIN_B, {
      payload: {
        cnpj: CNPJ_A,
        legalName: LEGAL_NAME,
        municipalityCode: SERRA,
        neighborhood: 'Centro',
        branchIds: [idB],
      },
    });
    const id = created.json().id as number;
    const res = await call('POST', `/v1/customers/${id}/deactivate`, ADMIN_A, { ifMatch: '"1"' });
    expect(res.statusCode).toBe(404);
    expect((await call('GET', `/v1/customers/${id}`, ADMIN_B)).headers.etag).toBe('"1"');
  });
});

describe('HTTP: vendedor compartilhado entre filiais', () => {
  const create = (code: string, who = ADMIN_B, branchIds = [idB]) =>
    call('POST', '/v1/sellers', who, { payload: { code, name: 'Zeferino Quaresma', branchIds } });

  it('link por código sem dados, leitura posterior, inativação por vínculo, 403 no nome', async () => {
    const id = (await create('V1')).json().id as number;
    const link = await call('POST', '/v1/sellers/by-code/V1/branches', ADMIN_A, {
      payload: { branchId: idA },
    });
    expect(link.statusCode).toBe(200);
    expect(link.headers.etag).toBe('"2"');
    expect(link.json()).toEqual({ id, version: 2 });
    expect(link.body).not.toContain('Zeferino');
    expect((await call('GET', `/v1/sellers/${id}`, ADMIN_A)).statusCode).toBe(200);

    const patch = await call('PATCH', `/v1/sellers/${id}`, ADMIN_A, {
      payload: { name: 'X' },
      ifMatch: '"2"',
    });
    expect(patch.statusCode).toBe(403);

    const off = await call('POST', `/v1/sellers/${id}/deactivate`, ADMIN_A, { ifMatch: '"2"' });
    expect(off.json()).toMatchObject({ active: false, version: 3 });
    expect((await call('GET', `/v1/sellers/${id}`, ADMIN_B)).json().active).toBe(true);

    const all = await call('POST', `/v1/sellers/${id}/deactivate`, ADMIN_AB, { ifMatch: '"3"' });
    expect(all.statusCode).toBe(200);
    expect((await call('GET', `/v1/sellers/${id}`, ADMIN_B)).json().active).toBe(false);
  });

  it('link: 401, 403 (não-admin / filial fora), 404, 400', async () => {
    await create('V1');
    const anon = await t.app.inject({ method: 'POST', url: '/v1/sellers/by-code/V1/branches' });
    expect(anon.statusCode).toBe(401);
    const post = (code: string, payload: Record<string, unknown>, who = ADMIN_A) =>
      call('POST', `/v1/sellers/by-code/${code}/branches`, who, { payload });
    expect((await post('V1', { branchId: idB })).statusCode).toBe(403);
    expect((await post('V1', { branchId: idA }, { roles: ['vendedor'], branches: ['FA'] })).statusCode).toBe(
      403,
    );
    expect((await post('NAO', { branchId: idA })).statusCode).toBe(404);
    expect((await post('V1', {})).statusCode).toBe(400);
  });

  it('código duplicado dá 409 seller_exists', async () => {
    await create('V1');
    const dup = await create('V1');
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: 'seller_exists' });
  });
});
