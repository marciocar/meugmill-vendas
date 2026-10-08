import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPortfolioTypeService } from '../../src/domain/portfolio-types/service.js';
import { neighborhoodKey, searchKey } from '../../src/domain/shared/normalize.js';
import { v1Routes } from '../../src/routes/v1/index.js';
import { makeRoutesFixture, type RoutesFixture, type TokenOptions } from '../helpers/jwt.js';
import { ES, SAO_PAULO, SERRA, SP, VITORIA, adminOf, seedBranch } from '../helpers/seed.js';

const ADMIN: TokenOptions = { sub: 'adm-1', roles: ['admin'], branches: ['SER'] };
const READER: TokenOptions = { sub: 'leitor-1', roles: ['vendedor'], branches: ['SER'] };
const OTHER: TokenOptions = { sub: 'adm-2', roles: ['admin'], branches: ['CAR'] };

let fx: RoutesFixture;
let ser: number;
let typeId: number;
let seq = 0;

const SERRA_AT = { state: ES, municipality: SERRA };
const VITORIA_AT = { state: ES, municipality: VITORIA };
const SP_AT = { state: SP, municipality: SAO_PAULO };

interface Region {
  level: 'state' | 'municipality' | 'neighborhood';
  stateCode: number;
  municipalityCode?: number;
  neighborhoodLabel?: string;
}

/** Cliente ativo na filial SER, num bairro dado (municípios distintos isolam um teste do outro). */
function customer(neighborhood: string, where: { state: number; municipality: number }): number {
  seq += 1;
  const name = `Cliente conflito ${seq}`;
  const id = fx.app.sqlite
    .prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
        neighborhood_key, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,?,1,1,1,'t','t')`,
    )
    .run(
      String(900000 + seq).padStart(14, '0'),
      name,
      searchKey(name),
      where.state,
      where.municipality,
      neighborhood,
      neighborhoodKey(neighborhood),
    ).lastInsertRowid as number;
  fx.app.sqlite
    .prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,1)')
    .run(id, ser);
  return id;
}

/** Carteira da SER com as regiões dadas. */
async function portfolio(name: string, regions: Region[]): Promise<number> {
  const created = await fx.app.inject({
    method: 'POST',
    url: '/v1/portfolios',
    headers: await fx.headers(ADMIN),
    payload: { name, branchId: ser, responsibleSub: 'resp-1', portfolioTypeId: typeId },
  });
  expect(created.statusCode).toBe(201);
  const { id } = created.json<{ id: number }>();
  const filters = await fx.app.inject({
    method: 'PUT',
    url: `/v1/portfolios/${id}/filters`,
    headers: await fx.headers({ ...ADMIN, ifMatch: created.headers.etag as string }),
    payload: { regions, retailNetworkIds: [], economicGroupIds: [] },
  });
  expect(filters.statusCode).toBe(200);
  return id;
}

interface Item {
  customer: { id: number };
  rank: number;
  resolution: string;
  competitors: { portfolioId: number; name: string; rank: number }[];
}
interface Preview {
  items: Item[];
  total: number;
}

const preview = async (id: number, qs = '', who: TokenOptions = READER) =>
  fx.app.inject({
    method: 'GET',
    url: `/v1/portfolios/${id}/preview${qs}`,
    headers: await fx.headers(who),
  });
const previewOf = async (id: number, qs = ''): Promise<Preview> => {
  const res = await preview(id, qs);
  expect(res.statusCode).toBe(200);
  return res.json<Preview>();
};
const aggregateOf = async (id: number, qs = '?include=conflicts') =>
  (
    await fx.app.inject({
      method: 'GET',
      url: `/v1/portfolios/${id}${qs}`,
      headers: await fx.headers(READER),
    })
  ).json<{ conflictsBlocked?: number; conflictsLost?: number }>();

beforeAll(async () => {
  fx = await makeRoutesFixture(v1Routes);
  ser = seedBranch(fx.db, 'SER');
  seedBranch(fx.db, 'CAR');
  typeId = createPortfolioTypeService(fx.db).create(adminOf('SER'), { code: 'T1', name: 'Tipo 1' }).id;
});
afterAll(() => fx.close());

describe('contrato HTTP: conflitos na prévia', () => {
  it('bairro x cidade: o bairro vence (assigned) e a cidade perde (lost), com concorrentes e agregado', async () => {
    const hood = 'Bairro Disputa A';
    const c = customer(hood, SERRA_AT);
    const byHood = await portfolio('Por bairro A', [
      { level: 'neighborhood', stateCode: ES, municipalityCode: SERRA, neighborhoodLabel: hood },
    ]);
    const byCity = await portfolio('Por cidade A', [
      { level: 'municipality', stateCode: ES, municipalityCode: SERRA },
    ]);

    const winner = (await previewOf(byHood)).items.find((i) => i.customer.id === c);
    expect(winner).toMatchObject({
      rank: 3,
      resolution: 'assigned',
      competitors: [{ portfolioId: byCity, name: 'Por cidade A', rank: 2 }],
    });

    const loser = (await previewOf(byCity)).items.find((i) => i.customer.id === c);
    expect(loser).toMatchObject({
      rank: 2,
      resolution: 'lost',
      competitors: [{ portfolioId: byHood, name: 'Por bairro A', rank: 3 }],
    });

    expect(await aggregateOf(byHood)).toMatchObject({ conflictsBlocked: 0, conflictsLost: 0 });
    expect((await aggregateOf(byCity)).conflictsLost).toBeGreaterThanOrEqual(1);
    // Sem `include=conflicts` o agregado não traz (nem calcula) as contagens.
    expect(await aggregateOf(byCity, '')).not.toHaveProperty('conflictsLost');
    expect(await aggregateOf(byCity, '')).not.toHaveProperty('conflictsBlocked');
  });

  it('mesmo posto: blocked nas duas, com contagem no agregado', async () => {
    const hood = 'Bairro Disputa B';
    const c = customer(hood, VITORIA_AT);
    const region: Region = {
      level: 'neighborhood',
      stateCode: ES,
      municipalityCode: VITORIA,
      neighborhoodLabel: hood,
    };
    const p1 = await portfolio('Empate B1', [region]);
    const p2 = await portfolio('Empate B2', [region]);

    for (const [id, other, otherName] of [
      [p1, p2, 'Empate B2'],
      [p2, p1, 'Empate B1'],
    ] as const) {
      const item = (await previewOf(id)).items.find((i) => i.customer.id === c);
      expect(item).toMatchObject({
        rank: 3,
        resolution: 'blocked',
        competitors: [{ portfolioId: other, name: otherName, rank: 3 }],
      });
      expect(await aggregateOf(id)).toMatchObject({ conflictsBlocked: 1, conflictsLost: 0 });
    }
  });

  it('filtro resolution restringe os itens e o total', async () => {
    const hood = 'Bairro Disputa C';
    const c1 = customer(hood, SP_AT);
    const c2 = customer(hood, SP_AT);
    const byHood = await portfolio('Por bairro C', [
      { level: 'neighborhood', stateCode: SP, municipalityCode: SAO_PAULO, neighborhoodLabel: hood },
    ]);
    const byCity = await portfolio('Por cidade C', [
      { level: 'municipality', stateCode: SP, municipalityCode: SAO_PAULO },
    ]);

    const lost = await previewOf(byCity, '?resolution=lost');
    expect(lost.items.every((i) => i.resolution === 'lost')).toBe(true);
    expect(lost.items.map((i) => i.customer.id)).toEqual(expect.arrayContaining([c1, c2]));
    expect(lost.total).toBe(lost.items.length);

    const assigned = await previewOf(byCity, '?resolution=assigned');
    expect(assigned.items.map((i) => i.customer.id)).not.toEqual(expect.arrayContaining([c1]));
    const all = await previewOf(byCity);
    expect(all.total).toBe(assigned.total + lost.total);

    expect((await previewOf(byCity, '?resolution=blocked')).total).toBe(0);
    const winner = await previewOf(byHood, '?resolution=assigned&limit=1');
    expect(winner.items).toHaveLength(1);
    expect(winner.total).toBe(2);
  });

  it('carteira inativa não concorre', async () => {
    const hood = 'Bairro Disputa D';
    const c = customer(hood, VITORIA_AT);
    const region: Region = {
      level: 'neighborhood',
      stateCode: ES,
      municipalityCode: VITORIA,
      neighborhoodLabel: hood,
    };
    const p1 = await portfolio('Inativa D1', [region]);
    const p2 = await portfolio('Inativa D2', [region]);
    expect((await previewOf(p1)).items.find((i) => i.customer.id === c)?.resolution).toBe('blocked');

    const current = await fx.app.inject({
      method: 'GET',
      url: `/v1/portfolios/${p2}`,
      headers: await fx.headers(ADMIN),
    });
    const off = await fx.app.inject({
      method: 'POST',
      url: `/v1/portfolios/${p2}/deactivate`,
      headers: await fx.headers({ ...ADMIN, ifMatch: current.headers.etag as string }),
    });
    expect(off.statusCode).toBe(200);
    expect((await previewOf(p1)).items.find((i) => i.customer.id === c)).toMatchObject({
      resolution: 'assigned',
      competitors: [],
    });
  });

  it('leitor de outra filial recebe 404 e não vê concorrentes', async () => {
    const id = await portfolio('Escopo E', [{ level: 'state', stateCode: ES }]);
    expect((await preview(id, '', OTHER)).statusCode).toBe(404);
    expect((await preview(id, '?resolution=lost', OTHER)).statusCode).toBe(404);
  });

  it('resolution inválida dá 400', async () => {
    const id = await portfolio('Validação F', [{ level: 'state', stateCode: ES }]);
    for (const qs of ['?resolution=foo', '?resolution=', '?resolution=ASSIGNED']) {
      expect((await preview(id, qs)).statusCode).toBe(400);
    }
  });

  it('include=conflicts é a única opção aceita; as demais dão 400', async () => {
    const id = await portfolio('Validação G', [{ level: 'state', stateCode: ES }]);
    const get = async (qs: string, who = READER) =>
      fx.app.inject({ method: 'GET', url: `/v1/portfolios/${id}${qs}`, headers: await fx.headers(who) });
    expect((await get('?include=conflicts')).statusCode).toBe(200);
    for (const qs of ['?include=foo', '?include=', '?include=CONFLICTS', '?include=conflicts,x']) {
      expect((await get(qs)).statusCode).toBe(400);
    }
    // Leitor de outra filial segue recebendo 404, com ou sem o include.
    expect((await get('?include=conflicts', OTHER)).statusCode).toBe(404);
  });
});
