import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPortfolioTypeService } from '../../src/domain/portfolio-types/service.js';
import { neighborhoodKey, searchKey } from '../../src/domain/shared/normalize.js';
import { v1Routes } from '../../src/routes/v1/index.js';
import { makeRoutesFixture, type RoutesFixture, type TokenOptions } from '../helpers/jwt.js';
import { ES, SERRA, adminOf, seedBranch } from '../helpers/seed.js';

const ADMIN: TokenOptions = { sub: 'adm-1', roles: ['admin'], branches: ['SER'] };
const OWNER: TokenOptions = { sub: 'resp-1', roles: ['vendedor'], branches: ['SER'] };
const READER: TokenOptions = { sub: 'leitor-1', roles: ['supervisao'], branches: ['SER'] };
const OTHER: TokenOptions = { sub: 'adm-2', roles: ['admin'], branches: ['CAR'] };

let fx: RoutesFixture;
let ser: number;
let typeId: number;
let seq = 0;
const NOW = 1_700_000_000_000;

function customer(hood: string): number {
  seq += 1;
  const name = `Cliente ${seq}`;
  const id = fx.app.sqlite
    .prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
        neighborhood_key, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,?,1,?,?,'t','t')`,
    )
    .run(
      String(seq).padStart(14, '0'),
      name,
      searchKey(name),
      ES,
      SERRA,
      hood,
      neighborhoodKey(hood),
      NOW,
      NOW,
    ).lastInsertRowid as number;
  fx.app.sqlite
    .prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,1)')
    .run(id, ser);
  return id;
}

function subgroup(code: string): number {
  return fx.app.sqlite
    .prepare(
      `insert into product_subgroups (code, name, name_key, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,'t','t')`,
    )
    .run(code, `Subgrupo ${code}`, searchKey(code), NOW, NOW).lastInsertRowid as number;
}

function seller(code: string): number {
  const id = fx.app.sqlite
    .prepare(
      `insert into sellers (code, name, name_key, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,1,?,?,'t','t')`,
    )
    .run(code, `Vendedor ${code}`, searchKey(code), NOW, NOW).lastInsertRowid as number;
  fx.app.sqlite
    .prepare('insert into seller_branches (seller_id, branch_id, active) values (?,?,1)')
    .run(id, ser);
  return id;
}

beforeAll(async () => {
  fx = await makeRoutesFixture(v1Routes);
  ser = seedBranch(fx.db, 'SER');
  seedBranch(fx.db, 'CAR');
  typeId = createPortfolioTypeService(fx.db).create(adminOf('SER'), { code: 'T1', name: 'Tipo 1' }).id;
});
afterAll(() => fx.close());

const call = async (
  method: 'GET' | 'POST' | 'PUT',
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

interface Setup {
  id: number;
  etag: string;
  g1: number;
  g2: number;
  a: number;
  b: number;
  c: number;
  customers: number[];
}

/** Carteira (bairro próprio) com g1 atendido por A e B, g2 atendido por C; 4 clientes. */
async function setup(): Promise<Setup> {
  seq += 1000;
  const hood = `Bairro ${seq}`; // bairro único: carteiras do teste não disputam clientes entre si
  const created = await call('POST', '', ADMIN, {
    body: { name: `Carteira ${seq}`, branchId: ser, responsibleSub: 'resp-1', portfolioTypeId: typeId },
  });
  expect(created.statusCode).toBe(201);
  const { id } = created.json<{ id: number }>();
  const filters = await call('PUT', `/${id}/filters`, OWNER, {
    ifMatch: created.headers.etag as string,
    body: {
      regions: [{ level: 'neighborhood', stateCode: ES, municipalityCode: SERRA, neighborhoodLabel: hood }],
      retailNetworkIds: [],
      economicGroupIds: [],
    },
  });
  expect(filters.statusCode).toBe(200);
  const g1 = subgroup(`G1-${seq}`);
  const g2 = subgroup(`G2-${seq}`);
  const a = seller(`A-${seq}`);
  const b = seller(`B-${seq}`);
  const c = seller(`C-${seq}`);
  const sellers = await call('PUT', `/${id}/sellers`, OWNER, {
    ifMatch: filters.headers.etag as string,
    body: {
      assignments: [
        { sellerId: a, productSubgroupId: g1 },
        { sellerId: b, productSubgroupId: g1 },
        { sellerId: c, productSubgroupId: g2 },
      ],
    },
  });
  expect(sellers.statusCode).toBe(200);
  const customers = [customer(hood), customer(hood), customer(hood), customer(hood)];
  return { id, etag: sellers.headers.etag as string, g1, g2, a, b, c, customers };
}

interface PageBody {
  items: {
    customer: { id: number };
    productSubgroup: { id: number };
    seller: { id: number } | null;
    status: string;
  }[];
  nextCursor: string | null;
  total: number;
}
interface SummaryBody {
  subgroups: {
    productSubgroup: { id: number };
    sellers: { seller: { id: number }; count: number }[];
    unassigned: number;
    stale: number;
  }[];
  totals: { members: number; cells: number; assigned: number; unassigned: number; stale: number };
}

describe('contrato HTTP: distribuição', () => {
  it('fluxo: distribute -> summary balanceado -> PUT set -> filtros -> stale', async () => {
    const s = await setup();
    const empty = (await call('GET', `/${s.id}/assignments/summary`, READER)).json<SummaryBody>();
    expect(empty.totals).toMatchObject({ members: 4, cells: 8, assigned: 0, unassigned: 8 });

    const dist = await call('POST', `/${s.id}/distribute`, OWNER, { ifMatch: s.etag, body: {} });
    expect(dist.statusCode).toBe(200);
    const distBody = dist.json<{
      portfolio: { id: number; version: number };
      distributed: Record<string, number>;
      skippedSubgroupIds: number[];
      finalCounts: Record<string, { sellerId: number; count: number }[]>;
    }>();
    expect(distBody.portfolio.id).toBe(s.id);
    expect(dist.headers.etag).toBe(`"${distBody.portfolio.version}"`);
    expect(distBody.distributed).toEqual({ [s.g1]: 4, [s.g2]: 4 });
    expect(distBody.skippedSubgroupIds).toEqual([]);
    // finalCounts chega ao cliente (o Fastify descarta da resposta o que não está no schema).
    for (const g of [s.g1, s.g2]) {
      const counts = distBody.finalCounts[String(g)]?.map((c) => c.count) ?? [];
      expect(counts.reduce((a, b) => a + b, 0)).toBe(4);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }

    // Sem nada a preencher: 200, nada gravado, mesma versão e mesmo ETag.
    const again = await call('POST', `/${s.id}/distribute`, OWNER, { ifMatch: dist.headers.etag, body: {} });
    expect(again.statusCode).toBe(200);
    expect(again.headers.etag).toBe(dist.headers.etag);

    const sum = (await call('GET', `/${s.id}/assignments/summary`, READER)).json<SummaryBody>();
    expect(sum.totals).toMatchObject({ assigned: 8, unassigned: 0, stale: 0 });
    const g1 = sum.subgroups.find((x) => x.productSubgroup.id === s.g1);
    expect(g1?.sellers.map((x) => x.count)).toEqual([2, 2]);

    // PUT set: troca o vendedor do primeiro cliente em g1 (A -> B ou B -> A).
    const first = (
      await call('GET', `/${s.id}/assignments?productSubgroupId=${s.g1}&limit=1`, READER)
    ).json<PageBody>();
    const cur = first.items[0]?.seller?.id as number;
    const other = cur === s.a ? s.b : s.a;
    const put = await call('PUT', `/${s.id}/assignments`, OWNER, {
      ifMatch: dist.headers.etag as string,
      body: { set: [{ customerId: s.customers[0], productSubgroupId: s.g1, sellerId: other }] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.headers.etag).toBe(`"${distBody.portfolio.version + 1}"`);

    const byOther = (await call('GET', `/${s.id}/assignments?sellerId=${other}`, READER)).json<PageBody>();
    expect(byOther.items.some((i) => i.customer.id === s.customers[0])).toBe(true);
    const paged = (await call('GET', `/${s.id}/assignments?limit=3`, READER)).json<PageBody>();
    expect(paged.items).toHaveLength(3);
    expect(paged.total).toBe(8);
    expect(paged.nextCursor).toEqual(expect.any(String));
    const next = (
      await call('GET', `/${s.id}/assignments?limit=3&cursor=${paged.nextCursor}`, READER)
    ).json<PageBody>();
    expect(next.items[0]).not.toEqual(paged.items[0]);
    const assigned = (await call('GET', `/${s.id}/assignments?status=assigned`, READER)).json<PageBody>();
    expect(assigned.total).toBe(8);

    // Inativar o vendedor C: as 4 células de g2 ficam stale.
    fx.app.sqlite.prepare('update sellers set active = 0 where id = ?').run(s.c);
    const stale = (await call('GET', `/${s.id}/assignments?status=stale`, READER)).json<PageBody>();
    expect(stale.total).toBe(4);
    expect(stale.items.every((i) => i.productSubgroup.id === s.g2 && i.seller?.id === s.c)).toBe(true);
    const sum2 = (await call('GET', `/${s.id}/assignments/summary`, READER)).json<SummaryBody>();
    expect(sum2.totals.stale).toBe(4);

    // clear remove uma atribuição.
    const cleared = await call('PUT', `/${s.id}/assignments`, ADMIN, {
      ifMatch: put.headers.etag as string,
      body: { clear: [{ customerId: s.customers[1], productSubgroupId: s.g1 }] },
    });
    expect(cleared.statusCode).toBe(200);
    const un = (await call('GET', `/${s.id}/assignments?status=unassigned`, READER)).json<PageBody>();
    expect(un.total).toBe(1);
  });

  it('distribute com productSubgroupIds restringe os subgrupos', async () => {
    const s = await setup();
    const res = await call('POST', `/${s.id}/distribute`, ADMIN, {
      ifMatch: s.etag,
      body: { productSubgroupIds: [s.g2] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ distributed: Record<string, number> }>().distributed).toEqual({ [s.g2]: 4 });
  });

  it('401 sem token; 404 fora do escopo e para carteira inexistente', async () => {
    const s = await setup();
    for (const [method, url] of [
      ['GET', `/${s.id}/assignments`],
      ['GET', `/${s.id}/assignments/summary`],
      ['PUT', `/${s.id}/assignments`],
      ['POST', `/${s.id}/distribute`],
    ] as const) {
      expect((await call(method, url, null, { body: {} })).statusCode).toBe(401);
    }
    expect((await call('GET', `/${s.id}/assignments`, OTHER)).statusCode).toBe(404);
    expect((await call('GET', `/${s.id}/assignments/summary`, OTHER)).statusCode).toBe(404);
    const put = await call('PUT', `/${s.id}/assignments`, OTHER, {
      ifMatch: s.etag,
      body: { clear: [{ customerId: 1, productSubgroupId: 1 }] },
    });
    expect(put.statusCode).toBe(404);
    const dist = await call('POST', `/${s.id}/distribute`, OTHER, { ifMatch: s.etag, body: {} });
    expect(dist.statusCode).toBe(404);
    expect((await call('GET', '/99999/assignments', ADMIN)).statusCode).toBe(404);
    expect((await call('GET', '/abc/assignments', ADMIN)).statusCode).toBe(400);
  });

  it('leitor lê, mas as escritas dão 403', async () => {
    const s = await setup();
    expect((await call('GET', `/${s.id}/assignments`, READER)).statusCode).toBe(200);
    const dist = await call('POST', `/${s.id}/distribute`, READER, { ifMatch: s.etag, body: {} });
    expect(dist.statusCode).toBe(403);
    expect(dist.json()).toEqual({ error: 'forbidden' });
    const put = await call('PUT', `/${s.id}/assignments`, READER, {
      ifMatch: s.etag,
      body: { clear: [{ customerId: s.customers[0], productSubgroupId: s.g1 }] },
    });
    expect(put.statusCode).toBe(403);
  });

  it('428 sem If-Match, 409 com versão velha, 400 com If-Match malformado', async () => {
    const s = await setup();
    for (const [method, url, body] of [
      ['POST', `/${s.id}/distribute`, {}],
      ['PUT', `/${s.id}/assignments`, { clear: [{ customerId: s.customers[0], productSubgroupId: s.g1 }] }],
    ] as const) {
      const missing = await call(method, url, ADMIN, { body });
      expect(missing.statusCode).toBe(428);
      expect(missing.json()).toEqual({ error: 'precondition_required' });
      const old = await call(method, url, ADMIN, { ifMatch: '"1"', body });
      expect(old.statusCode).toBe(409);
      expect(old.json()).toEqual({ error: 'version_conflict' });
      for (const bad of ['*', 'abc', '"0"', '']) {
        expect((await call(method, url, ADMIN, { ifMatch: bad, body })).statusCode).toBe(400);
      }
    }
  });

  it('POST /distribute aceita corpo ausente', async () => {
    const s = await setup();
    const res = await fx.app.inject({
      method: 'POST',
      url: `/v1/portfolios/${s.id}/distribute`,
      headers: await fx.headers({ ...ADMIN, ifMatch: s.etag }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('query inválida dá 400 (status, limit, cursor, ids)', async () => {
    const s = await setup();
    for (const qs of ['status=x', 'limit=0', 'limit=201', 'cursor=!!', 'productSubgroupId=0', 'sellerId=a']) {
      expect((await call('GET', `/${s.id}/assignments?${qs}`, READER)).statusCode).toBe(400);
    }
  });

  it('carteira inativa dá 409 portfolio_inactive nas escritas', async () => {
    const s = await setup();
    const off = await fx.app.inject({
      method: 'POST',
      url: `/v1/portfolios/${s.id}/deactivate`,
      headers: await fx.headers({ ...ADMIN, ifMatch: s.etag }),
    });
    expect(off.statusCode).toBe(200);
    const res = await call('POST', `/${s.id}/distribute`, ADMIN, {
      ifMatch: off.headers.etag as string,
      body: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'portfolio_inactive' });
  });

  it('erros de validação não ecoam os ids enviados', async () => {
    const s = await setup();
    const stranger = 7_654_321;
    const cases: unknown[] = [
      { set: [{ customerId: stranger, productSubgroupId: s.g1, sellerId: s.a }] },
      { set: [{ customerId: s.customers[0], productSubgroupId: stranger, sellerId: s.a }] },
      { set: [{ customerId: s.customers[0], productSubgroupId: s.g1, sellerId: stranger }] },
      { set: [{ customerId: s.customers[0], productSubgroupId: s.g1, sellerId: s.c }] },
      {
        set: [{ customerId: s.customers[0], productSubgroupId: s.g1, sellerId: s.a }],
        clear: [{ customerId: s.customers[0], productSubgroupId: s.g1 }],
      },
      {},
    ];
    for (const body of cases) {
      const res = await call('PUT', `/${s.id}/assignments`, ADMIN, { ifMatch: s.etag, body });
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toMatch(new RegExp(`\\b${stranger}\\b`));
    }
    const dist = await call('POST', `/${s.id}/distribute`, ADMIN, {
      ifMatch: s.etag,
      body: { productSubgroupIds: [stranger] },
    });
    expect(dist.statusCode).toBe(400);
    expect(dist.body).not.toMatch(new RegExp(`\\b${stranger}\\b`));
  });
});
