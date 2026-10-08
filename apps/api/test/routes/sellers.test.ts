import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeRoutesFixture, type RoutesFixture } from '../helpers/jwt.js';
import { v1Routes } from '../../src/routes/v1/index.js';
import { seedBranch } from '../helpers/seed.js';

let t: RoutesFixture;
let idA: number;
let idB: number;

const ADMIN_A = { roles: ['admin'], branches: ['FA'] };
const ADMIN_B = { roles: ['admin'], branches: ['FB'] };
const NAME = 'Zeferino Quaresmeira da Silva';

beforeEach(async () => {
  t = await makeRoutesFixture(v1Routes);
  idA = seedBranch(t.db, 'FA');
  idB = seedBranch(t.db, 'FB');
});

afterEach(async () => {
  await t.app.close();
});

async function create(code: string, branchIds: number[], who = ADMIN_A, name = NAME) {
  return t.app.inject({
    method: 'POST',
    url: '/v1/sellers',
    headers: await t.headers(who),
    payload: { code, name, branchIds },
  });
}

describe('rotas de vendedores', () => {
  it('401 sem token em todas as rotas', async () => {
    for (const [method, url] of [
      ['GET', '/v1/sellers'],
      ['GET', '/v1/sellers/1'],
      ['POST', '/v1/sellers'],
      ['PATCH', '/v1/sellers/1'],
      ['POST', '/v1/sellers/1/deactivate'],
    ] as const) {
      const res = await t.app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('admin cria vendedor: 201 com ETag "1" e só as filiais do escopo', async () => {
    const res = await create('V1', [idA]);
    expect(res.statusCode).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    const body = res.json();
    expect(body).toMatchObject({ code: 'V1', name: NAME, version: 1, active: true });
    expect(body.branches).toEqual([{ id: idA, code: 'FA', name: 'Filial FA', active: true }]);
  });

  it('não-admin recebe 403 ao escrever, mas lê', async () => {
    const created = await create('V1', [idA]);
    const reader = await t.headers({ roles: ['vendedor'], branches: ['FA'] });
    const post = await t.app.inject({
      method: 'POST',
      url: '/v1/sellers',
      headers: reader,
      payload: { code: 'V2', name: 'Outro', branchIds: [idA] },
    });
    expect(post.statusCode).toBe(403);
    expect(post.json()).toEqual({ error: 'forbidden' });
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/v1/sellers/${created.json().id}`,
      headers: { ...reader, 'if-match': '"1"' },
      payload: { name: 'X' },
    });
    expect(patch.statusCode).toBe(403);
    const get = await t.app.inject({
      method: 'GET',
      url: `/v1/sellers/${created.json().id}`,
      headers: reader,
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers.etag).toBe('"1"');
  });

  it('código duplicado dá 409 seller_exists; corpo inválido dá 400', async () => {
    await create('V1', [idA]);
    const dup = await create('V1', [idA]);
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: 'seller_exists' });
    const bad = await t.app.inject({
      method: 'POST',
      url: '/v1/sellers',
      headers: await t.headers(ADMIN_A),
      payload: { code: 'V9', branchIds: [idA] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('validation_error');
  });

  it('filial fora do token ao criar dá 403', async () => {
    const res = await create('V1', [idB]);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
  });

  it('ator da filial A não vê vendedor só da B: 404 no GET e ausente na lista', async () => {
    const onlyB = (await create('VB', [idB], ADMIN_B)).json();
    const onlyA = (await create('VA', [idA])).json();
    const headers = await t.headers(ADMIN_A);
    const get = await t.app.inject({ method: 'GET', url: `/v1/sellers/${onlyB.id}`, headers });
    expect(get.statusCode).toBe(404);
    expect(get.json()).toEqual({ error: 'not_found' });
    const list = await t.app.inject({ method: 'GET', url: '/v1/sellers', headers });
    expect(list.json().items.map((s: { id: number }) => s.id)).toEqual([onlyA.id]);
  });

  it('resposta só traz as filiais do escopo do ator', async () => {
    const both = (await create('VAB', [idA, idB], { roles: ['admin'], branches: ['FA', 'FB'] })).json();
    expect(both.branches).toHaveLength(2);
    const asA = await t.app.inject({
      method: 'GET',
      url: `/v1/sellers/${both.id}`,
      headers: await t.headers(ADMIN_A),
    });
    expect(asA.json().branches.map((b: { code: string }) => b.code)).toEqual(['FA']);
  });

  it('PATCH: sem If-Match 428, versão velha 409, ok 200 com ETag "2"', async () => {
    const { id } = (await create('V1', [idA])).json();
    const headers = await t.headers(ADMIN_A);
    const url = `/v1/sellers/${id}`;

    const none = await t.app.inject({ method: 'PATCH', url, headers, payload: { name: 'Novo' } });
    expect(none.statusCode).toBe(428);
    expect(none.json()).toEqual({ error: 'precondition_required' });

    const stale = await t.app.inject({
      method: 'PATCH',
      url,
      headers: { ...headers, 'if-match': '"7"' },
      payload: { name: 'Novo' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'version_conflict' });

    const ok = await t.app.inject({
      method: 'PATCH',
      url,
      headers: { ...headers, 'if-match': '"1"' },
      payload: { name: 'Novo Nome' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('"2"');
    expect(ok.json()).toMatchObject({ name: 'Novo Nome', version: 2 });
  });

  it('adicionar filial fora do token via PATCH dá 403', async () => {
    const { id } = (await create('V1', [idA])).json();
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/v1/sellers/${id}`,
      headers: { ...(await t.headers(ADMIN_A)), 'if-match': '"1"' },
      payload: { branchIds: [idA, idB] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('deactivate e reactivate são idempotentes e exigem If-Match', async () => {
    const { id } = (await create('V1', [idA])).json();
    const headers = await t.headers(ADMIN_A);
    const act = (action: string, ifMatch?: string) =>
      t.app.inject({
        method: 'POST',
        url: `/v1/sellers/${id}/${action}`,
        headers: ifMatch ? { ...headers, 'if-match': ifMatch } : headers,
      });

    expect((await act('deactivate')).statusCode).toBe(428);
    const off = await act('deactivate', '"1"');
    expect(off.statusCode).toBe(200);
    expect(off.json().active).toBe(false);
    expect(off.headers.etag).toBe('"2"');
    // Repetir não muda nada, mesmo com versão defasada.
    const again = await act('deactivate', '"1"');
    expect(again.statusCode).toBe(200);
    expect(again.headers.etag).toBe('"2"');

    const on = await act('reactivate', '"2"');
    expect(on.json().active).toBe(true);
    expect(on.headers.etag).toBe('"3"');
    expect((await act('reactivate', '"2"')).headers.etag).toBe('"3"');
  });

  it('If-Match malformado dá 400', async () => {
    const { id } = (await create('V1', [idA])).json();
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/v1/sellers/${id}`,
      headers: { ...(await t.headers(ADMIN_A)), 'if-match': 'abc' },
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('pagina com limit e cursor, e filtra por q e active', async () => {
    for (const n of [1, 2, 3]) await create(`V${n}`, [idA], ADMIN_A, `Vendedor ${n}`);
    const headers = await t.headers(ADMIN_A);
    const p1 = (await t.app.inject({ method: 'GET', url: '/v1/sellers?limit=2', headers })).json();
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = (
      await t.app.inject({
        method: 'GET',
        url: `/v1/sellers?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`,
        headers,
      })
    ).json();
    expect(p2.items.map((s: { code: string }) => s.code)).toEqual(['V3']);
    expect(p2.nextCursor).toBeNull();

    const q = (await t.app.inject({ method: 'GET', url: '/v1/sellers?q=Vendedor%202', headers })).json();
    expect(q.items.map((s: { code: string }) => s.code)).toEqual(['V2']);
    const inactive = (await t.app.inject({ method: 'GET', url: '/v1/sellers?active=false', headers })).json();
    expect(inactive.items).toEqual([]);

    const badLimit = await t.app.inject({ method: 'GET', url: '/v1/sellers?limit=0', headers });
    expect(badLimit.statusCode).toBe(400);
    const badCursor = await t.app.inject({ method: 'GET', url: '/v1/sellers?cursor=@@', headers });
    expect(badCursor.statusCode).toBe(400);
  });

  it('LGPD: o nome do vendedor não aparece em log nem em respostas de erro', async () => {
    const secretName = 'Anastácio Ribamar Nepomuceno';
    const headers = await t.headers(ADMIN_A);
    const created = await create('V1', [idA], ADMIN_A, secretName);
    const { id } = created.json();
    const responses = [
      await create('V1', [idA], ADMIN_A, secretName), // 409
      await create('V2', [idB], ADMIN_A, secretName), // 403
      await t.app.inject({
        method: 'POST',
        url: '/v1/sellers',
        headers,
        payload: { code: 'V3', name: secretName }, // 400
      }),
      await t.app.inject({
        method: 'PATCH',
        url: `/v1/sellers/${id}`,
        headers,
        payload: { name: secretName }, // 428
      }),
      await t.app.inject({
        method: 'PATCH',
        url: `/v1/sellers/${id}`,
        headers: { ...headers, 'if-match': '"9"' },
        payload: { name: secretName }, // 409
      }),
      await t.app.inject({ method: 'GET', url: '/v1/sellers/999', headers }),
    ];
    expect(responses.map((r) => r.statusCode)).toEqual([409, 403, 400, 428, 409, 404]);
    for (const res of responses) expect(res.body).not.toContain(secretName);
    expect(t.logs.length).toBeGreaterThan(0);
    expect(t.logs.join('')).not.toContain(secretName);
    expect(t.logs.join('')).not.toContain('Anastácio');
  });
});
