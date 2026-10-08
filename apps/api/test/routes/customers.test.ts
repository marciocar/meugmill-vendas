import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeRoutesFixture, type RoutesFixture } from '../helpers/jwt.js';
import { v1Routes } from '../../src/routes/v1/index.js';
import { CNPJ_A, CNPJ_B, ES, SERRA, SP, seedBranch, seedRetailNetwork, VITORIA } from '../helpers/seed.js';

let t: RoutesFixture;
let idA: number;
let idB: number;

const ADMIN_A = { roles: ['admin'], branches: ['FA'] };
const ADMIN_B = { roles: ['admin'], branches: ['FB'] };
const MASKED_A = '11.222.333/0001-81';
const LEGAL_NAME = 'Drogaria Bom Remédio Ltda';

beforeEach(async () => {
  t = await makeRoutesFixture(v1Routes);
  idA = seedBranch(t.db, 'FA');
  idB = seedBranch(t.db, 'FB');
});

afterEach(async () => {
  await t.app.close();
});

function body(overrides: Record<string, unknown> = {}) {
  return {
    cnpj: CNPJ_A,
    legalName: LEGAL_NAME,
    municipalityCode: SERRA,
    neighborhood: 'Centro',
    branchIds: [idA],
    ...overrides,
  };
}

async function create(overrides: Record<string, unknown> = {}, who = ADMIN_A) {
  return t.app.inject({
    method: 'POST',
    url: '/v1/customers',
    headers: await t.headers(who),
    payload: body(overrides),
  });
}

describe('rotas de clientes', () => {
  it('401 sem token em todas as rotas', async () => {
    for (const [method, url] of [
      ['GET', '/v1/customers'],
      ['GET', '/v1/customers/1'],
      ['POST', '/v1/customers'],
      ['PATCH', '/v1/customers/1'],
      ['POST', '/v1/customers/1/reactivate'],
      ['POST', `/v1/customers/by-cnpj/${CNPJ_A}/branches`],
    ] as const) {
      const res = await t.app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('admin cria cliente: 201 com ETag "1", UF derivada do município', async () => {
    const res = await create();
    expect(res.statusCode).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    expect(res.json()).toMatchObject({
      cnpj: CNPJ_A,
      legalName: LEGAL_NAME,
      stateCode: ES,
      municipalityCode: SERRA,
      version: 1,
      active: true,
      branches: [{ id: idA, code: 'FA', name: 'Filial FA' }],
    });
  });

  it('não-admin recebe 403 ao escrever', async () => {
    const res = await create({}, { roles: ['vendedor'], branches: ['FA'] });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
  });

  it('CNPJ inválido dá 400 sem ecoar o valor', async () => {
    const res = await create({ cnpj: '11222333000182' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
    expect(res.body).not.toContain('11222333000182');
  });

  it('CNPJ com máscara é aceito e normalizado', async () => {
    const res = await create({ cnpj: MASKED_A });
    expect(res.statusCode).toBe(201);
    expect(res.json().cnpj).toBe(CNPJ_A);
  });

  it('CNPJ alfanumérico (minúsculas e máscara) é aceito, normalizado e ligável pelo path', async () => {
    const res = await create({ cnpj: '12.abc.345/01de-35' });
    expect(res.statusCode).toBe(201);
    expect(res.json().cnpj).toBe('12ABC34501DE35');
    const link = await t.app.inject({
      method: 'POST',
      url: `/v1/customers/by-cnpj/${encodeURIComponent('12.ABC.345/01DE-35')}/branches`,
      headers: await t.headers(ADMIN_A),
      payload: { branchId: idA },
    });
    expect(link.statusCode).toBe(200);
    expect(link.json().cnpj).toBe('12ABC34501DE35');
    const bad = await create({ cnpj: '12ABC34501DE34' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain('12ABC34501DE34');
    const badPath = await t.app.inject({
      method: 'POST',
      url: '/v1/customers/by-cnpj/12ABC34501DE34/branches',
      headers: await t.headers(ADMIN_A),
      payload: { branchId: idA },
    });
    expect(badPath.statusCode).toBe(400);
  });

  it('CNPJ existente em outra filial dá 409 customer_exists; o link por CNPJ funciona e é idempotente', async () => {
    const onlyB = (await create({ branchIds: [idB] }, ADMIN_B)).json();
    const dup = await create();
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: 'customer_exists' });

    const headers = await t.headers(ADMIN_A);
    // O cliente ainda é invisível para a filial A.
    expect(
      (await t.app.inject({ method: 'GET', url: `/v1/customers/${onlyB.id}`, headers })).statusCode,
    ).toBe(404);

    const link = () =>
      t.app.inject({
        method: 'POST',
        url: `/v1/customers/by-cnpj/${encodeURIComponent(MASKED_A)}/branches`,
        headers,
        payload: { branchId: idA },
      });
    const first = await link();
    expect(first.statusCode).toBe(200);
    expect(first.headers.etag).toBe('"2"');
    expect(first.json().id).toBe(onlyB.id);
    // A resposta mostra só a filial do escopo do ator (A), não a B.
    expect(first.json().branches.map((b: { code: string }) => b.code)).toEqual(['FA']);

    const second = await link();
    expect(second.statusCode).toBe(200);
    expect(second.headers.etag).toBe('"2"');

    // Também aceita só dígitos no path.
    const digits = await t.app.inject({
      method: 'POST',
      url: `/v1/customers/by-cnpj/${CNPJ_A}/branches`,
      headers,
      payload: { branchId: idA },
    });
    expect(digits.statusCode).toBe(200);
    expect(
      (await t.app.inject({ method: 'GET', url: `/v1/customers/${onlyB.id}`, headers })).statusCode,
    ).toBe(200);
  });

  it('link por CNPJ: filial fora do token 403, CNPJ inexistente 404, inválido 400, não-admin 403', async () => {
    await create();
    const url = (cnpj: string) => `/v1/customers/by-cnpj/${cnpj}/branches`;
    const post = async (cnpj: string, payload: Record<string, unknown>, who = ADMIN_A) =>
      t.app.inject({ method: 'POST', url: url(cnpj), headers: await t.headers(who), payload });

    expect((await post(CNPJ_A, { branchId: idB })).statusCode).toBe(403);
    expect((await post(CNPJ_B, { branchId: idA })).statusCode).toBe(404);
    expect((await post('11222333000182', { branchId: idA })).statusCode).toBe(400);
    expect((await post('abc', { branchId: idA })).statusCode).toBe(400);
    expect((await post(CNPJ_A, {})).statusCode).toBe(400);
    expect(
      (await post(CNPJ_A, { branchId: idA }, { roles: ['vendedor'], branches: ['FA'] })).statusCode,
    ).toBe(403);
  });

  it('ator da filial A não vê cliente só da B: 404 no GET e ausente na lista', async () => {
    const onlyB = (await create({ branchIds: [idB] }, ADMIN_B)).json();
    const onlyA = (await create({ cnpj: CNPJ_B })).json();
    const headers = await t.headers(ADMIN_A);
    const get = await t.app.inject({ method: 'GET', url: `/v1/customers/${onlyB.id}`, headers });
    expect(get.statusCode).toBe(404);
    expect(get.json()).toEqual({ error: 'not_found' });
    const list = await t.app.inject({ method: 'GET', url: '/v1/customers', headers });
    expect(list.json().items.map((c: { id: number }) => c.id)).toEqual([onlyA.id]);
  });

  it('resposta só traz as filiais do escopo do ator', async () => {
    const both = (
      await create({ branchIds: [idA, idB] }, { roles: ['admin'], branches: ['FA', 'FB'] })
    ).json();
    expect(both.branches).toHaveLength(2);
    const asA = await t.app.inject({
      method: 'GET',
      url: `/v1/customers/${both.id}`,
      headers: await t.headers(ADMIN_A),
    });
    expect(asA.json().branches.map((b: { code: string }) => b.code)).toEqual(['FA']);
  });

  it('PATCH: sem If-Match 428, velho 409, ok 200 com ETag "2"', async () => {
    const { id } = (await create()).json();
    const headers = await t.headers(ADMIN_A);
    const url = `/v1/customers/${id}`;

    const none = await t.app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { neighborhood: 'Laranjeiras' },
    });
    expect(none.statusCode).toBe(428);
    expect(none.json()).toEqual({ error: 'precondition_required' });

    const stale = await t.app.inject({
      method: 'PATCH',
      url,
      headers: { ...headers, 'if-match': '"5"' },
      payload: { neighborhood: 'Laranjeiras' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'version_conflict' });

    const ok = await t.app.inject({
      method: 'PATCH',
      url,
      headers: { ...headers, 'if-match': '"1"' },
      payload: { neighborhood: 'Laranjeiras', tradeName: null },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('"2"');
    expect(ok.json()).toMatchObject({ neighborhood: 'Laranjeiras', version: 2, tradeName: null });
  });

  it('adicionar filial fora do token via PATCH dá 403', async () => {
    const { id } = (await create()).json();
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/v1/customers/${id}`,
      headers: { ...(await t.headers(ADMIN_A)), 'if-match': '"1"' },
      payload: { branchIds: [idA, idB] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('deactivate e reactivate são idempotentes e exigem If-Match', async () => {
    const { id } = (await create()).json();
    const headers = await t.headers(ADMIN_A);
    const act = (action: string, ifMatch?: string) =>
      t.app.inject({
        method: 'POST',
        url: `/v1/customers/${id}/${action}`,
        headers: ifMatch ? { ...headers, 'if-match': ifMatch } : headers,
      });

    expect((await act('deactivate')).statusCode).toBe(428);
    const off = await act('deactivate', '"1"');
    expect(off.json().active).toBe(false);
    expect(off.headers.etag).toBe('"2"');
    expect((await act('deactivate', '"1"')).headers.etag).toBe('"2"');
    const on = await act('reactivate', '"2"');
    expect(on.json().active).toBe(true);
    expect(on.headers.etag).toBe('"3"');
    expect((await act('reactivate', '"2"')).headers.etag).toBe('"3"');
  });

  it('município incoerente com a UF dá 400; município inexistente dá 400', async () => {
    const mismatch = await create({ stateCode: SP, municipalityCode: SERRA });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error).toBe('validation_error');
    const unknown = await create({ municipalityCode: 1 });
    expect(unknown.statusCode).toBe(400);
    const ok = await create({ stateCode: ES, municipalityCode: VITORIA });
    expect(ok.statusCode).toBe(201);
  });

  it('rede inexistente dá 400; rede válida é aceita', async () => {
    const missing = await create({ retailNetworkId: 9999 });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe('validation_error');
    const networkId = seedRetailNetwork(t.db, 'R1');
    const ok = await create({ retailNetworkId: networkId });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().retailNetworkId).toBe(networkId);
  });

  it('pagina com limit e cursor, e busca por CNPJ mascarado', async () => {
    await create({ cnpj: CNPJ_A, legalName: 'Alfa' });
    await create({ cnpj: CNPJ_B, legalName: 'Beta' });
    const headers = await t.headers(ADMIN_A);
    const p1 = (await t.app.inject({ method: 'GET', url: '/v1/customers?limit=1', headers })).json();
    expect(p1.items.map((c: { legalName: string }) => c.legalName)).toEqual(['Alfa']);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = (
      await t.app.inject({
        method: 'GET',
        url: `/v1/customers?limit=1&cursor=${encodeURIComponent(p1.nextCursor)}`,
        headers,
      })
    ).json();
    expect(p2.items.map((c: { legalName: string }) => c.legalName)).toEqual(['Beta']);
    expect(p2.nextCursor).toBeNull();

    const byCnpj = (
      await t.app.inject({ method: 'GET', url: `/v1/customers?q=${encodeURIComponent(MASKED_A)}`, headers })
    ).json();
    expect(byCnpj.items.map((c: { cnpj: string }) => c.cnpj)).toEqual([CNPJ_A]);
    expect((await t.app.inject({ method: 'GET', url: '/v1/customers?limit=201', headers })).statusCode).toBe(
      400,
    );
  });

  it('LGPD: CNPJ e razão social não aparecem em log nem em respostas de erro', async () => {
    const headers = await t.headers(ADMIN_A);
    const { id } = (await create()).json();
    const responses = [
      await create(), // 409 customer_exists
      await create({ branchIds: [idB] }), // 403
      await create({ cnpj: '12.345.678/0001-00' }), // 400 CNPJ inválido
      await t.app.inject({
        method: 'PATCH',
        url: `/v1/customers/${id}`,
        headers: { ...headers, 'if-match': '"9"' },
        payload: { legalName: LEGAL_NAME },
      }), // 409 version_conflict
      await t.app.inject({
        method: 'POST',
        url: `/v1/customers/by-cnpj/${encodeURIComponent(MASKED_A)}/branches`,
        headers,
        payload: { branchId: idB },
      }), // 403
      await t.app.inject({
        method: 'POST',
        url: `/v1/customers/by-cnpj/${CNPJ_B}/branches`,
        headers,
        payload: { branchId: idA },
      }), // 404
      await t.app.inject({ method: 'GET', url: `/v1/customers?q=${CNPJ_A}`, headers }),
    ];
    expect(responses.map((r) => r.statusCode)).toEqual([409, 403, 400, 409, 403, 404, 200]);
    const errors = responses.slice(0, 6);
    for (const res of errors) {
      expect(res.body).not.toContain(CNPJ_A);
      expect(res.body).not.toContain('12.345.678');
      expect(res.body).not.toContain(LEGAL_NAME);
    }
    const log = t.logs.join('');
    expect(log.length).toBeGreaterThan(0);
    for (const secret of [
      CNPJ_A,
      CNPJ_B,
      MASKED_A,
      '11.222.333',
      '11%2E222',
      '12.345.678',
      '12345678',
      LEGAL_NAME,
    ]) {
      expect(log, secret).not.toContain(secret);
    }
  });
});
