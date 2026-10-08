import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPortfolioTypeService } from '../../src/domain/portfolio-types/service.js';
import { neighborhoodKey, searchKey } from '../../src/domain/shared/normalize.js';
import { v1Routes } from '../../src/routes/v1/index.js';
import { makeRoutesFixture, type RoutesFixture, type TokenOptions } from '../helpers/jwt.js';
import { ES, SAO_PAULO, SERRA, SP, adminOf, seedBranch } from '../helpers/seed.js';

const ADMIN: TokenOptions = { sub: 'adm-1', roles: ['admin'], branches: ['SER'] };
const OWNER: TokenOptions = { sub: 'resp-1', roles: ['vendedor'], branches: ['SER'] };
const READER: TokenOptions = { sub: 'leitor-1', roles: ['supervisao'], branches: ['SER'] };
const OTHER: TokenOptions = { sub: 'adm-2', roles: ['admin'], branches: ['CAR'] };

const SECRET_NAME = 'Drogaria Segredo Sigilosa Ltda';
const SECRET_CNPJ = '11222333000181';

let fx: RoutesFixture;
let ser: number;
let typeId: number;
let seq = 0;

function customer(
  o: { name?: string; cnpj?: string; municipality?: number; state?: number; active?: boolean } = {},
): number {
  seq += 1;
  const name = o.name ?? `Cliente ${seq}`;
  const id = fx.app.sqlite
    .prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
        neighborhood_key, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      o.cnpj ?? String(seq).padStart(14, '0'),
      name,
      searchKey(name),
      o.state ?? ES,
      o.municipality ?? SERRA,
      'Centro',
      neighborhoodKey('Centro'),
      o.active === false ? 0 : 1,
      1_700_000_000_000,
      1_700_000_000_000,
      't',
      't',
    ).lastInsertRowid as number;
  fx.app.sqlite
    .prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,1)')
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

/** Carteira com filtro de UF = ES. Devolve o id e o ETag atual. */
async function portfolioWithFilter(): Promise<{ id: number; etag: string }> {
  const created = await call('POST', '', ADMIN, {
    body: { name: `Carteira ${++seq}`, branchId: ser, responsibleSub: 'resp-1', portfolioTypeId: typeId },
  });
  expect(created.statusCode).toBe(201);
  const { id } = created.json<{ id: number }>();
  const filters = await call('PUT', `/${id}/filters`, OWNER, {
    ifMatch: created.headers.etag as string,
    body: { regions: [{ level: 'state', stateCode: ES }], retailNetworkIds: [], economicGroupIds: [] },
  });
  expect(filters.statusCode).toBe(200);
  return { id, etag: filters.headers.etag as string };
}

interface PreviewBody {
  items: { customer: { id: number }; source: string; matchedRegionLevel: string | null }[];
  nextCursor: string | null;
  total: number;
}

describe('contrato HTTP: prévia e ajustes', () => {
  it('fluxo: carteira -> filtros -> prévia -> ajustes -> prévia de novo', async () => {
    const { id, etag } = await portfolioWithFilter();
    const matched = customer();
    const excluded = customer();
    const manual = customer({ municipality: SAO_PAULO, state: SP });

    const first = await call('GET', `/${id}/preview`, READER);
    expect(first.statusCode).toBe(200);
    const body = first.json<PreviewBody>();
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.customer.id)).toEqual([matched, excluded]);
    expect(body.items[0]).toMatchObject({ source: 'filter', matchedRegionLevel: 'state' });

    const saved = await call('PUT', `/${id}/overrides`, OWNER, {
      ifMatch: etag,
      body: { include: [manual], exclude: [excluded] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers.etag).toBe('"3"');
    expect(saved.json()).toMatchObject({ overridesInclude: 1, overridesExclude: 1, version: 3 });

    const after = (await call('GET', `/${id}/preview`, READER)).json<PreviewBody>();
    expect(after.total).toBe(2);
    expect(after.items.map((i) => [i.customer.id, i.source])).toEqual([
      [matched, 'filter'],
      [manual, 'manual'],
    ]);

    const manualOnly = (await call('GET', `/${id}/preview?source=manual`, READER)).json<PreviewBody>();
    expect(manualOnly.items.map((i) => i.customer.id)).toEqual([manual]);
    const paged = (await call('GET', `/${id}/preview?limit=1`, READER)).json<PreviewBody>();
    expect(paged.items).toHaveLength(1);
    expect(paged.nextCursor).toEqual(expect.any(String));
    expect(paged.total).toBe(2);

    const listed = await call('GET', `/${id}/overrides`, READER);
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      include: [{ customer: { id: manual }, effective: true }],
      exclude: [{ customer: { id: excluded }, effective: true }],
    });

    const agg = await call('GET', `/${id}`, READER);
    expect(agg.json()).toMatchObject({ overridesInclude: 1, overridesExclude: 1 });
  });

  it('401 sem token, 404 fora do escopo e para carteira inexistente', async () => {
    const { id, etag } = await portfolioWithFilter();
    for (const [method, url] of [
      ['GET', `/${id}/preview`],
      ['GET', `/${id}/overrides`],
      ['PUT', `/${id}/overrides`],
    ] as const) {
      const res = await call(method, url, null, { body: { include: [], exclude: [] } });
      expect(res.statusCode).toBe(401);
    }
    expect((await call('GET', `/${id}/preview`, OTHER)).statusCode).toBe(404);
    expect((await call('GET', `/${id}/overrides`, OTHER)).statusCode).toBe(404);
    expect(
      (await call('PUT', `/${id}/overrides`, OTHER, { ifMatch: etag, body: { include: [], exclude: [] } }))
        .statusCode,
    ).toBe(404);
    expect((await call('GET', '/99999/preview', ADMIN)).statusCode).toBe(404);
    expect((await call('GET', '/abc/preview', ADMIN)).statusCode).toBe(400);
  });

  it('leitor lê, mas o PUT dá 403; query inválida dá 400', async () => {
    const { id, etag } = await portfolioWithFilter();
    const res = await call('PUT', `/${id}/overrides`, READER, {
      ifMatch: etag,
      body: { include: [], exclude: [] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
    for (const qs of ['source=x', 'limit=0', 'limit=201', 'cursor=!!']) {
      expect((await call('GET', `/${id}/preview?${qs}`, READER)).statusCode).toBe(400);
    }
  });

  it('428 sem If-Match, 409 com versão velha, 400 com If-Match malformado', async () => {
    const { id, etag } = await portfolioWithFilter();
    const body = { include: [], exclude: [] };
    const missing = await call('PUT', `/${id}/overrides`, ADMIN, { body });
    expect(missing.statusCode).toBe(428);
    expect(missing.json()).toEqual({ error: 'precondition_required' });
    const stale = await call('PUT', `/${id}/overrides`, ADMIN, { ifMatch: '"1"', body });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'version_conflict' });
    for (const bad of ['*', 'abc', '"0"', '']) {
      const res = await call('PUT', `/${id}/overrides`, ADMIN, { ifMatch: bad, body });
      expect(res.statusCode).toBe(400);
    }
    const ok = await call('PUT', `/${id}/overrides`, ADMIN, { ifMatch: etag, body });
    expect(ok.statusCode).toBe(200);
  });

  it('carteira inativa dá 409 portfolio_inactive', async () => {
    const { id, etag } = await portfolioWithFilter();
    const off = await fx.app.inject({
      method: 'POST',
      url: `/v1/portfolios/${id}/deactivate`,
      headers: await fx.headers({ ...ADMIN, ifMatch: etag }),
    });
    expect(off.statusCode).toBe(200);
    const res = await call('PUT', `/${id}/overrides`, ADMIN, {
      ifMatch: off.headers.etag as string,
      body: { include: [], exclude: [] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'portfolio_inactive' });
  });

  it('erros de validação não ecoam os ids enviados', async () => {
    const { id, etag } = await portfolioWithFilter();
    const known = customer();
    const inactive = customer({ active: false });
    const stranger = 7_654_321;
    const cases: unknown[] = [
      { include: [known, known], exclude: [] },
      { include: [known], exclude: [known] },
      { include: [], exclude: [stranger] },
      { include: [inactive], exclude: [] },
      { include: [-5], exclude: [] },
      { include: ['x'], exclude: [] },
    ];
    for (const body of cases) {
      const res = await call('PUT', `/${id}/overrides`, ADMIN, { ifMatch: etag, body });
      expect(res.statusCode).toBe(400);
      for (const value of [known, inactive, stranger, 5]) {
        expect(res.body).not.toMatch(new RegExp(`\\b${value}\\b`));
      }
    }
  });

  it('limite de 5.000 ajustes com clientes reais: 5.000 aceitos; 5.001 dá 400 com a mensagem do limite', async () => {
    const { id, etag } = await portfolioWithFilter();
    const insC = fx.app.sqlite.prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
        neighborhood_key, active, created_at, updated_at, created_by, updated_by)
       values (?,?,?,?,?,?,?,1,1,1,'t','t')`,
    );
    const insL = fx.app.sqlite.prepare(
      'insert into customer_branches (customer_id, branch_id, active) values (?,?,1)',
    );
    const ids: number[] = [];
    fx.app.sqlite.transaction(() => {
      for (let i = 0; i < 5001; i++) {
        seq += 1;
        const cid = insC.run(
          String(seq).padStart(14, '0'),
          `Lote ${seq}`,
          `LOTE ${seq}`,
          ES,
          SERRA,
          'Centro',
          'CENTRO',
        ).lastInsertRowid as number;
        insL.run(cid, ser);
        ids.push(cid);
      }
    })();
    const tooMany = await call('PUT', `/${id}/overrides`, ADMIN, {
      ifMatch: etag,
      body: { include: ids.slice(0, 3000), exclude: ids.slice(3000) },
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json()).toEqual({ error: 'validation_error', message: 'Limite de ajustes excedido' });
    const ok = await call('PUT', `/${id}/overrides`, ADMIN, {
      ifMatch: etag,
      body: { include: ids.slice(0, 3000), exclude: ids.slice(3000, 5000) },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ overridesInclude: 3000, overridesExclude: 2000 });
  }, 30000);

  it('LGPD: CNPJ e razão social não aparecem nos logs da requisição de prévia', async () => {
    const { id } = await portfolioWithFilter();
    customer({ name: SECRET_NAME, cnpj: SECRET_CNPJ });
    fx.logs.length = 0;
    const res = await call('GET', `/${id}/preview?q=${encodeURIComponent('Segredo')}`, READER);
    expect(res.statusCode).toBe(200);
    // o dado existe na resposta, mas não no log
    expect(res.body).toContain(SECRET_CNPJ);
    expect(res.body).toContain(SECRET_NAME);
    const text = fx.logs.join('\n');
    expect(fx.logs.length).toBeGreaterThan(0);
    expect(text).toContain('/preview');
    for (const s of [SECRET_CNPJ, '11.222.333', SECRET_NAME, 'Sigilosa']) expect(text).not.toContain(s);
  });
});
