import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProductSubgroupService } from '../../src/domain/catalog/service.js';
import { createPortfolioTypeService } from '../../src/domain/portfolio-types/service.js';
import { createSellerService } from '../../src/domain/sellers/service.js';
import { v1Routes } from '../../src/routes/v1/index.js';
import { makeRoutesFixture, type RoutesFixture, type TokenOptions } from '../helpers/jwt.js';
import { ES, SERRA, adminOf, seedBranch, seedEconomicGroup, seedRetailNetwork } from '../helpers/seed.js';

const ADMIN: TokenOptions = { sub: 'adm-1', roles: ['admin'], branches: ['SER'] };
const OWNER: TokenOptions = { sub: 'resp-1', roles: ['vendedor'], branches: ['SER'] };
const READER: TokenOptions = { sub: 'leitor-1', roles: ['vendedor'], branches: ['SER'] };
const OTHER: TokenOptions = { sub: 'adm-2', roles: ['admin'], branches: ['CAR'] };

let fx: RoutesFixture;
let ser: number;
let typeId: number;
let sellerId: number;
let subgroupId: number;
let networkId: number;
let groupId: number;

beforeAll(async () => {
  fx = await makeRoutesFixture(v1Routes);
  ser = seedBranch(fx.db, 'SER');
  seedBranch(fx.db, 'CAR');
  const admin = adminOf('SER');
  typeId = createPortfolioTypeService(fx.db).create(admin, { code: 'T1', name: 'Tipo 1' }).id;
  subgroupId = createProductSubgroupService(fx.db).create(admin, { code: 'SG1', name: 'Genéricos' }).id;
  sellerId = createSellerService(fx.db).create(admin, {
    code: 'V1',
    name: 'Vendedor 1',
    branchIds: [ser],
  }).id;
  networkId = seedRetailNetwork(fx.db, 'R1');
  groupId = seedEconomicGroup(fx.db, 'G1');
});
afterAll(() => fx.close());

const branchId = (code: string): number =>
  (fx.app.sqlite.prepare('select id from branches where code = ?').get(code) as { id: number }).id;

let seq = 0;
const call = async (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  who: TokenOptions | null,
  extra: { body?: unknown; ifMatch?: string } = {},
) =>
  fx.app.inject({
    method,
    url: `/v1/portfolios${url}`,
    headers: who
      ? await fx.headers({ ...who, ...(extra.ifMatch !== undefined ? { ifMatch: extra.ifMatch } : {}) })
      : {},
    ...(extra.body !== undefined ? { payload: extra.body as object } : {}),
  });

const post = async (id: number, action: string, who: TokenOptions, ifMatch?: string) =>
  fx.app.inject({
    method: 'POST',
    url: `/v1/portfolios/${id}/${action}`,
    headers: await fx.headers({ ...who, ...(ifMatch ? { ifMatch } : {}) }),
  });

const newBody = (over: Record<string, unknown> = {}) => ({
  name: `Carteira ${++seq}`,
  branchId: ser,
  responsibleSub: 'resp-1',
  portfolioTypeId: typeId,
  ...over,
});
const create = async (over: Record<string, unknown> = {}) => {
  const res = await call('POST', '', ADMIN, { body: newBody(over) });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: number }>().id;
};

describe('contrato HTTP portfolios', () => {
  it('fluxo do wizard: rascunho -> filtros -> vendedores -> resumo, com ETag a cada passo', async () => {
    const created = await call('POST', '', ADMIN, {
      body: newBody({ name: 'Wizard', description: 'Zona norte' }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    const { id } = created.json<{ id: number }>();
    expect(created.json()).toMatchObject({
      status: 'draft',
      active: true,
      version: 1,
      responsibleSub: 'resp-1',
    });

    const filters = await call('PUT', `/${id}/filters`, OWNER, {
      ifMatch: '"1"',
      body: {
        regions: [
          { level: 'state', stateCode: ES },
          {
            level: 'neighborhood',
            stateCode: ES,
            municipalityCode: SERRA,
            neighborhoodLabel: 'Jardim Câmburi',
          },
        ],
        retailNetworkIds: [networkId],
        economicGroupIds: [groupId],
      },
    });
    expect(filters.statusCode).toBe(200);
    expect(filters.headers.etag).toBe('"2"');
    expect(filters.json<{ filters: { regions: unknown[] } }>().filters.regions).toHaveLength(2);

    const sellers = await call('PUT', `/${id}/sellers`, OWNER, {
      ifMatch: filters.headers.etag as string,
      body: { assignments: [{ sellerId, productSubgroupId: subgroupId }] },
    });
    expect(sellers.statusCode).toBe(200);
    expect(sellers.headers.etag).toBe('"3"');

    const got = await call('GET', `/${id}`, READER);
    expect(got.statusCode).toBe(200);
    expect(got.headers.etag).toBe('"3"');
    expect(got.json()).toMatchObject({
      name: 'Wizard',
      description: 'Zona norte',
      branch: { code: 'SER' },
      type: { code: 'T1' },
      filters: {
        regions: [
          { level: 'state', stateCode: ES, uf: 'ES' },
          { level: 'neighborhood', neighborhoodKey: 'JARDIM CAMBURI', neighborhoodLabel: 'Jardim Câmburi' },
        ],
        retailNetworks: [{ code: 'R1' }],
        economicGroups: [{ code: 'G1' }],
      },
      sellers: [{ seller: { code: 'V1' }, productSubgroup: { code: 'SG1' } }],
    });
    expect(got.body).not.toContain('createdBy');

    const list = await call('GET', '?q=wizard&status=draft&active=true', READER);
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: unknown[] }>().items).toEqual([
      expect.objectContaining({
        id,
        regionsCount: 2,
        retailNetworksCount: 1,
        economicGroupsCount: 1,
        sellersCount: 1,
        version: 3,
      }),
    ]);
  });

  it('401 sem token, mesmo com corpo ou id inválidos (auth antes da validação)', async () => {
    expect((await call('GET', '', null)).statusCode).toBe(401);
    expect((await call('POST', '', null, { body: { lixo: true } })).statusCode).toBe(401);
    expect((await call('GET', '/abc', null)).statusCode).toBe(401);
    expect((await call('PUT', '/abc/filters', null, { body: { lixo: true } })).statusCode).toBe(401);
    expect((await call('PUT', '/1/sellers', null)).statusCode).toBe(401);
    expect((await call('PATCH', '/1', null)).statusCode).toBe(401);
    const post = await fx.app.inject({ method: 'POST', url: '/v1/portfolios/1/deactivate' });
    expect(post.statusCode).toBe(401);
  });

  it('403: leitor não cria nem edita; responsável não troca filial/responsável nem inativa', async () => {
    const denied = await call('POST', '', READER, { body: newBody({ name: 'SEGREDO-1' }) });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'forbidden' });
    expect(denied.body).not.toContain('SEGREDO-1');

    const id = await create();
    const body = { regions: [], retailNetworkIds: [], economicGroupIds: [] };
    expect((await call('PATCH', `/${id}`, READER, { body: { name: 'Z' }, ifMatch: '1' })).statusCode).toBe(
      403,
    );
    expect((await call('PUT', `/${id}/filters`, READER, { body, ifMatch: '1' })).statusCode).toBe(403);
    expect(
      (await call('PUT', `/${id}/sellers`, READER, { body: { assignments: [] }, ifMatch: '1' })).statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', `/${id}`, OWNER, { body: { responsibleSub: 'outro' }, ifMatch: '1' })).statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', `/${id}`, OWNER, { body: { branchId: ser + 1 }, ifMatch: '1' })).statusCode,
    ).toBe(403);
    const off = await fx.app.inject({
      method: 'POST',
      url: `/v1/portfolios/${id}/deactivate`,
      headers: await fx.headers({ ...OWNER, ifMatch: '1' }),
    });
    expect(off.statusCode).toBe(403);
    // O responsável edita as informações.
    const ok = await call('PATCH', `/${id}`, OWNER, { body: { name: 'Renomeada' }, ifMatch: '1' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('"2"');
  });

  it('404: inexistente e filial fora do token (também nas escritas)', async () => {
    const id = await create();
    expect((await call('GET', '/999999', READER)).json()).toEqual({ error: 'not_found' });
    for (const res of [
      await call('GET', `/${id}`, OTHER),
      await call('PATCH', `/${id}`, OTHER, { body: { name: 'Z' }, ifMatch: '1' }),
      await call('PUT', `/${id}/filters`, OTHER, {
        body: { regions: [], retailNetworkIds: [], economicGroupIds: [] },
        ifMatch: '1',
      }),
      await call('PUT', `/${id}/sellers`, OTHER, { body: { assignments: [] }, ifMatch: '1' }),
      await post(id, 'deactivate', OTHER, '1'),
      await post(id, 'reactivate', OTHER, '1'),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
    const list = await call('GET', '', OTHER);
    expect(list.json<{ items: unknown[] }>().items).toEqual([]);
  });

  it('409 conflict (nome) e version_conflict; 428 sem If-Match', async () => {
    const id = await create({ name: 'Duplicada' });
    const dup = await call('POST', '', ADMIN, { body: newBody({ name: 'DUPLICADA' }) });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: 'conflict' });

    const none = await call('PATCH', `/${id}`, ADMIN, { body: { name: 'Nova' } });
    expect(none.statusCode).toBe(428);
    expect(none.json()).toEqual({ error: 'precondition_required' });
    expect(
      (
        await call('PUT', `/${id}/filters`, ADMIN, {
          body: { regions: [], retailNetworkIds: [], economicGroupIds: [] },
        })
      ).statusCode,
    ).toBe(428);
    expect((await call('PUT', `/${id}/sellers`, ADMIN, { body: { assignments: [] } })).statusCode).toBe(428);

    expect(
      (await call('PATCH', `/${id}`, ADMIN, { body: { name: 'Nova' }, ifMatch: '"1"' })).statusCode,
    ).toBe(200);
    const stale = await call('PUT', `/${id}/sellers`, ADMIN, { body: { assignments: [] }, ifMatch: '"1"' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'version_conflict' });
  });

  it('If-Match malformado -> 400 sem eco, em todas as escritas', async () => {
    const id = await create();
    const filters = { regions: [], retailNetworkIds: [], economicGroupIds: [] };
    for (const bad of ['*', 'abc-secreto', '"0"']) {
      const results = [
        await call('PATCH', `/${id}`, ADMIN, { body: { name: 'Z' }, ifMatch: bad }),
        await call('PUT', `/${id}/filters`, ADMIN, { body: filters, ifMatch: bad }),
        await call('PUT', `/${id}/sellers`, ADMIN, { body: { assignments: [] }, ifMatch: bad }),
        await fx.app.inject({
          method: 'POST',
          url: `/v1/portfolios/${id}/deactivate`,
          headers: await fx.headers({ ...ADMIN, ifMatch: bad }),
        }),
      ];
      for (const res of results) {
        expect(res.statusCode, bad).toBe(400);
        expect(res.json<{ error: string }>().error).toBe('validation_error');
        expect(res.body).not.toContain('secreto');
      }
    }
  });

  it('400 sem eco do valor enviado (corpo, regra de negócio, id e querystring)', async () => {
    const id = await create();
    const bad = [
      await call('POST', '', ADMIN, { body: newBody({ name: 'SEGREDO-3'.padEnd(130, 'x') }) }),
      await call('POST', '', ADMIN, { body: newBody({ portfolioTypeId: 987654 }) }),
      await call('PUT', `/${id}/filters`, ADMIN, {
        ifMatch: '1',
        body: {
          regions: [{ level: 'neighborhood', stateCode: ES, neighborhoodLabel: 'SEGREDO-4' }],
          retailNetworkIds: [],
          economicGroupIds: [],
        },
      }),
      await call('PUT', `/${id}/filters`, ADMIN, {
        ifMatch: '1',
        body: { regions: [], retailNetworkIds: [999], economicGroupIds: [] },
      }),
      await call('PUT', `/${id}/sellers`, ADMIN, {
        ifMatch: '1',
        body: { assignments: [{ sellerId: 999, productSubgroupId: 999 }] },
      }),
      await call('PUT', `/${id}/sellers`, ADMIN, {
        ifMatch: '1',
        body: {
          assignments: [
            { sellerId, productSubgroupId: subgroupId },
            { sellerId, productSubgroupId: subgroupId },
          ],
        },
      }),
      await call('PATCH', `/${id}`, ADMIN, { ifMatch: '1', body: {} }),
      await call('GET', '/abcxyz', READER),
      await call('GET', '/0', READER),
      await call('GET', '?status=SEGREDO-5', READER),
      await call('GET', '?limit=0', READER),
      await call('GET', '?cursor=@@@', READER),
    ];
    for (const res of bad) {
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('validation_error');
      for (const leak of ['SEGREDO', 'abcxyz', '987654']) expect(res.body).not.toContain(leak);
    }
  });

  it('PATCH troca filial incompatível -> 400 e troca como admin das duas filiais', async () => {
    const id = await create();
    const both: TokenOptions = { sub: 'adm-3', roles: ['admin'], branches: ['SER', 'CAR'] };
    await call('PUT', `/${id}/sellers`, ADMIN, {
      ifMatch: '1',
      body: { assignments: [{ sellerId, productSubgroupId: subgroupId }] },
    });
    const car = fx.app.sqlite.prepare("select id from branches where code = 'CAR'").get() as { id: number };
    const res = await call('PATCH', `/${id}`, both, { ifMatch: '2', body: { branchId: car.id } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('validation_error');
  });

  it('PATCH troca de filial como admin das duas filiais: 200, versão sobe e ETag acompanha', async () => {
    const both: TokenOptions = { sub: 'adm-3', roles: ['admin'], branches: ['SER', 'CAR'] };
    const carId = branchId('CAR');
    const swapper = createSellerService(fx.db).create(adminOf('SER', 'CAR'), {
      code: 'V-SWAP',
      name: 'Vendedor Troca',
      branchIds: [ser, carId],
    }).id;
    const id = await create();
    const set = await call('PUT', `/${id}/sellers`, ADMIN, {
      ifMatch: '1',
      body: { assignments: [{ sellerId: swapper, productSubgroupId: subgroupId }] },
    });
    expect(set.statusCode).toBe(200);
    // o responsável (sem poder de troca) com versão velha recebe 403, não 409
    const stale = await call('PATCH', `/${id}`, OWNER, { ifMatch: '1', body: { responsibleSub: 'outro' } });
    expect(stale.statusCode).toBe(403);
    const res = await call('PATCH', `/${id}`, both, { ifMatch: '2', body: { branchId: carId } });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe('"3"');
    expect(res.json()).toMatchObject({ branch: { code: 'CAR' }, version: 3 });
  });

  it('deactivate/reactivate: só admin, idempotentes, ETag', async () => {
    const id = await create();
    const send = async (action: string, ifMatch?: string, who: TokenOptions = ADMIN) =>
      fx.app.inject({
        method: 'POST',
        url: `/v1/portfolios/${id}/${action}`,
        headers: await fx.headers({ ...who, ...(ifMatch ? { ifMatch } : {}) }),
      });
    expect((await send('deactivate')).statusCode).toBe(428);
    const off = await send('deactivate', '1');
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ active: false, status: 'draft' });
    expect(off.headers.etag).toBe('"2"');
    const again = await send('deactivate', '2');
    expect(again.headers.etag).toBe('"2"');
    expect(again.json<{ active: boolean }>().active).toBe(false);
    const on = await send('reactivate', '2');
    expect(on.json<{ active: boolean }>().active).toBe(true);
    expect(on.headers.etag).toBe('"3"');
    expect((await send('reactivate', '3')).headers.etag).toBe('"3"');
    expect((await send('reactivate', '3', READER)).statusCode).toBe(403);
    expect((await send('reactivate', '3', OTHER)).statusCode).toBe(404);
  });

  it('lista: filtros e paginação por cursor', async () => {
    for (let i = 0; i < 3; i++) await create({ responsibleSub: 'pag-resp' });
    const seen = new Set<number>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await call(
        'GET',
        `?responsibleSub=pag-resp&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        READER,
      );
      const page = res.json<{ items: { id: number }[]; nextCursor: string | null }>();
      for (const i of page.items) seen.add(i.id);
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(2);
    expect(seen.size).toBe(3);
    await create({ name: 'Carteira Busca Z' });
    const byName = await call('GET', `?branchId=${ser}&q=carteira`, READER);
    expect(byName.statusCode).toBe(200);
    const names = byName.json<{ items: { name: string; branch: { id: number } }[] }>().items;
    expect(names.length).toBeGreaterThan(0);
    for (const item of names) {
      expect(item.name.toLowerCase()).toContain('carteira');
      expect(item.branch.id).toBe(ser);
    }
    expect(names.map((i) => i.name)).toContain('Carteira Busca Z');
  });

  it('lista: active=false devolve só inativas, status inválido -> 400, duas filiais no token', async () => {
    const both: TokenOptions = { sub: 'adm-3', roles: ['admin'], branches: ['SER', 'CAR'] };
    const carId = branchId('CAR');
    const mine = await create({ name: 'Lista Ativa X' });
    const off = await create({ name: 'Lista Inativa X' });
    expect((await post(off, 'deactivate', ADMIN, '1')).statusCode).toBe(200);
    const created = await call('POST', '', both, {
      body: newBody({ name: 'Lista Em CAR', branchId: carId, responsibleSub: 'lista-car' }),
    });
    expect(created.statusCode).toBe(201);
    const carPortfolio = created.json<{ id: number }>().id;

    const ids = async (query: string, who: TokenOptions) =>
      (await call('GET', query, who)).json<{ items: { id: number; active: boolean }[] }>().items;
    const inactive = await ids('?active=false&q=lista', READER);
    expect(inactive.map((i) => i.id)).toEqual([off]);
    expect(inactive.every((i) => !i.active)).toBe(true);
    expect((await ids('?active=true&q=lista', READER)).map((i) => i.id)).toEqual([mine]);

    expect((await ids('?q=lista', both)).map((i) => i.id)).toEqual([mine, off, carPortfolio]);
    expect((await ids(`?q=lista&branchId=${carId}`, both)).map((i) => i.id)).toEqual([carPortfolio]);
    // o responsável de uma carteira fora do escopo não aparece para quem não enxerga a filial
    expect(await ids('?responsibleSub=lista-car', READER)).toEqual([]);
    expect((await ids('?responsibleSub=lista-car', both)).map((i) => i.id)).toEqual([carPortfolio]);

    const bad = await call('GET', '?status=foo', READER);
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error: string }>().error).toBe('validation_error');
  });

  it('busca q ignora pontuação: "norte farmacias" acha "Norte — Farmácias"', async () => {
    const id = await create({ name: 'Norte — Farmácias HTTP' });
    const res = await call('GET', '?q=norte%20farmacias%20http', READER);
    expect(res.json<{ items: { id: number }[] }>().items.map((i) => i.id)).toEqual([id]);
    const dup = await call('POST', '', ADMIN, { body: newBody({ name: 'NORTE / FARMACIAS - HTTP' }) });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: 'conflict' });
  });

  it('carteira inativa: edição -> 409 portfolio_inactive; reativar libera', async () => {
    const id = await create();
    expect((await post(id, 'deactivate', ADMIN, '1')).statusCode).toBe(200);
    const filters = { regions: [], retailNetworkIds: [], economicGroupIds: [] };
    for (const res of [
      await call('PATCH', `/${id}`, ADMIN, { body: { name: 'Z' }, ifMatch: '2' }),
      await call('PUT', `/${id}/filters`, ADMIN, { body: filters, ifMatch: '1' }),
      await call('PUT', `/${id}/sellers`, OWNER, { body: { assignments: [] }, ifMatch: '2' }),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'portfolio_inactive' });
    }
    expect((await post(id, 'reactivate', ADMIN, '2')).statusCode).toBe(200);
    expect(
      (await call('PATCH', `/${id}`, ADMIN, { body: { name: 'Voltou' }, ifMatch: '3' })).statusCode,
    ).toBe(200);
  });

  it('reativar com filial inativa -> 400; deactivate sem If-Match -> 428', async () => {
    const id = await create();
    expect((await post(id, 'deactivate', ADMIN)).statusCode).toBe(428);
    expect((await post(id, 'deactivate', ADMIN, '1')).statusCode).toBe(200);
    fx.app.sqlite.prepare('update branches set active = 0 where id = ?').run(ser);
    const res = await post(id, 'reactivate', ADMIN, '2');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('validation_error');
    fx.app.sqlite.prepare('update branches set active = 1 where id = ?').run(ser);
    expect((await post(id, 'reactivate', ADMIN, '2')).statusCode).toBe(200);
  });
});
