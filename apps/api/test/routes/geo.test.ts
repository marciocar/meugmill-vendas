import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v1Routes } from '../../src/routes/v1/index.js';
import { makeRoutesFixture, READER, type RoutesFixture } from '../helpers/jwt.js';
import { SERRA } from '../helpers/seed.js';

describe('GET /v1/geo', () => {
  let fx: RoutesFixture;
  beforeAll(async () => {
    fx = await makeRoutesFixture(v1Routes);
  });
  afterAll(() => fx.close());

  const get = async (url: string, auth = true) =>
    fx.app.inject({ method: 'GET', url, headers: auth ? await fx.headers(READER) : {} });

  it('401 sem token', async () => {
    expect((await get('/v1/geo/states', false)).statusCode).toBe(401);
    expect((await get('/v1/geo/municipalities', false)).statusCode).toBe(401);
  });

  it('401 (não 400) sem token mesmo com query inválida: auth roda antes da validação', async () => {
    expect((await get('/v1/geo/municipalities?limit=0', false)).statusCode).toBe(401);
  });

  it('lista as 27 UFs', async () => {
    const res = await get('/v1/geo/states');
    expect(res.statusCode).toBe(200);
    expect(res.json<unknown[]>()).toHaveLength(27);
  });

  it('municípios do ES contêm Serra', async () => {
    const res = await get('/v1/geo/municipalities?uf=ES&limit=200');
    expect(res.statusCode).toBe(200);
    const page = res.json<{ items: { ibgeCode: number; name: string }[] }>();
    expect(page.items.some((m) => m.ibgeCode === SERRA && m.name === 'Serra')).toBe(true);
  });

  it('busca q=vitoria acha Vitória (sem acento)', async () => {
    const res = await get('/v1/geo/municipalities?uf=ES&q=vitoria');
    expect(res.json<{ items: { name: string }[] }>().items.map((m) => m.name)).toContain('Vitória');
  });

  it('paginação por cursor', async () => {
    const first = (await get('/v1/geo/municipalities?uf=ES&limit=10')).json<{
      items: { ibgeCode: number }[];
      nextCursor: string | null;
    }>();
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    const second = (await get(`/v1/geo/municipalities?uf=ES&limit=10&cursor=${first.nextCursor}`)).json<{
      items: { ibgeCode: number }[];
    }>();
    expect(second.items[0]?.ibgeCode).toBeGreaterThan(first.items[9]?.ibgeCode ?? 0);
  });

  it('parâmetros inválidos -> 400 sem eco', async () => {
    const lim = await get('/v1/geo/municipalities?limit=abcxyz');
    expect(lim.statusCode).toBe(400);
    expect(lim.body).not.toContain('abcxyz');
    const cur = await get('/v1/geo/municipalities?cursor=@@@');
    expect(cur.statusCode).toBe(400);
    expect(cur.body).not.toContain('@@@');
  });
});
