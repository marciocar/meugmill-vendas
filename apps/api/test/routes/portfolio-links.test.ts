import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

beforeEach(async () => {
  fx = await makeRoutesFixture(v1Routes);
  ser = seedBranch(fx.db, 'SER');
  seedBranch(fx.db, 'CAR');
  typeId = createPortfolioTypeService(fx.db).create(adminOf('SER'), { code: 'T1', name: 'Tipo 1' }).id;
});
afterEach(() => fx.close());

const call = async (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  who: TokenOptions | null,
  extra: { body?: unknown; ifMatch?: string } = {},
) =>
  fx.app.inject({
    method,
    url: `/v1${url}`,
    headers: who
      ? await fx.headers({ ...who, ...(extra.ifMatch !== undefined ? { ifMatch: extra.ifMatch } : {}) })
      : {},
    ...(extra.body !== undefined ? { payload: extra.body as object } : {}),
  });

interface Setup {
  id: number;
  etag: string;
  hood: string;
  g1: number;
  g2: number;
  a: number;
  b: number;
  c: number;
  customers: number[];
}

type Level = 'neighborhood' | 'municipality';

/**
 * Carteira com g1 atendido por A e B, g2 atendido por C e 4 clientes. O bairro é único por carteira,
 * exceto quando `hood` é passado (para disputar clientes com outra carteira).
 */
async function setup(
  opts: { hood?: string; level?: Level; customers?: number[]; name?: string; groups?: [number, number] } = {},
) {
  seq += 1000;
  const hood = opts.hood ?? `Bairro ${seq}`;
  const level = opts.level ?? 'neighborhood';
  const created = await call('POST', '/portfolios', ADMIN, {
    body: {
      name: opts.name ?? `Carteira ${seq}`,
      branchId: ser,
      responsibleSub: 'resp-1',
      portfolioTypeId: typeId,
    },
  });
  expect(created.statusCode).toBe(201);
  const { id } = created.json<{ id: number }>();
  const region =
    level === 'neighborhood'
      ? { level, stateCode: ES, municipalityCode: SERRA, neighborhoodLabel: hood }
      : { level, stateCode: ES, municipalityCode: SERRA };
  const filters = await call('PUT', `/portfolios/${id}/filters`, OWNER, {
    ifMatch: created.headers.etag as string,
    body: { regions: [region], retailNetworkIds: [], economicGroupIds: [] },
  });
  expect(filters.statusCode).toBe(200);
  const g1 = opts.groups?.[0] ?? subgroup(`G1-${seq}`);
  const g2 = opts.groups?.[1] ?? subgroup(`G2-${seq}`);
  const a = seller(`A-${seq}`);
  const b = seller(`B-${seq}`);
  const c = seller(`C-${seq}`);
  const sellers = await call('PUT', `/portfolios/${id}/sellers`, OWNER, {
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
  const customers = opts.customers ?? [customer(hood), customer(hood), customer(hood), customer(hood)];
  return { id, etag: sellers.headers.etag as string, hood, g1, g2, a, b, c, customers } satisfies Setup;
}

async function distribute(s: Setup, etag = s.etag): Promise<string> {
  const res = await call('POST', `/portfolios/${s.id}/distribute`, OWNER, { ifMatch: etag, body: {} });
  expect(res.statusCode).toBe(200);
  return res.headers.etag as string;
}

interface LinkPage {
  items: {
    id: number;
    customer: { id: number };
    productSubgroup: { id: number };
    seller: { id: number };
    active: boolean;
    validTo: number | null;
  }[];
  nextCursor: string | null;
  total: number;
}
interface EventPage {
  items: { id: number; kind: 'created' | 'ended'; customer: { id: number } }[];
  nextAfter: number | null;
  hasMore: boolean;
}
interface FinalizeBody {
  portfolio: { id: number; status: string; version: number; finalizedAt: number | null };
  created: number;
  ended: number;
  kept: number;
  takenOver: number;
}

describe('contrato HTTP: vínculos da carteira', () => {
  it('ciclo: finalize -> links -> troca de vendedor -> re-finalize -> history -> link-events', async () => {
    const s = await setup();
    const etag = await distribute(s);
    const never = (await call('GET', `/portfolios/${s.id}`, READER)).json<{ finalizedAt: number | null }>();
    expect(never.finalizedAt).toBeNull();

    const fin = await call('POST', `/portfolios/${s.id}/finalize`, OWNER, { ifMatch: etag });
    expect(fin.statusCode).toBe(200);
    const finBody = fin.json<FinalizeBody>();
    expect(finBody).toMatchObject({ created: 8, ended: 0, kept: 0 });
    expect(finBody.portfolio).toMatchObject({ id: s.id, status: 'active' });
    expect(finBody.portfolio.finalizedAt).toEqual(expect.any(Number));
    expect(fin.headers.etag).toBe(`"${finBody.portfolio.version}"`);
    expect(fin.body).not.toContain('finalizedBy');

    const all = (await call('GET', `/portfolios/${s.id}/links`, READER)).json<LinkPage>();
    expect(all.total).toBe(8);
    expect(all.items.every((i) => i.active && i.validTo === null)).toBe(true);
    const byG1 = (
      await call('GET', `/portfolios/${s.id}/links?productSubgroupId=${s.g1}`, READER)
    ).json<LinkPage>();
    expect(byG1.total).toBe(4);
    const byC = (await call('GET', `/portfolios/${s.id}/links?sellerId=${s.c}`, READER)).json<LinkPage>();
    expect(byC.total).toBe(4);
    expect(byC.items.every((i) => i.productSubgroup.id === s.g2)).toBe(true);
    const page1 = (await call('GET', `/portfolios/${s.id}/links?limit=3`, READER)).json<LinkPage>();
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).toEqual(expect.any(String));
    const page2 = (
      await call('GET', `/portfolios/${s.id}/links?limit=3&cursor=${page1.nextCursor}`, READER)
    ).json<LinkPage>();
    expect(page2.items[0]?.id).toBeGreaterThan(page1.items[2]?.id as number);

    // Troca o vendedor de um cliente em g1 e finaliza de novo.
    const target = s.customers[0] as number;
    const cur = byG1.items.find((i) => i.customer.id === target)?.seller.id as number;
    const other = cur === s.a ? s.b : s.a;
    const put = await call('PUT', `/portfolios/${s.id}/assignments`, OWNER, {
      ifMatch: fin.headers.etag as string,
      body: { set: [{ customerId: target, productSubgroupId: s.g1, sellerId: other }] },
    });
    expect(put.statusCode).toBe(200);
    const again = await call('POST', `/portfolios/${s.id}/finalize`, OWNER, {
      ifMatch: put.headers.etag as string,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<FinalizeBody>()).toMatchObject({ created: 1, ended: 1, kept: 7 });

    // Sem mudança: nada gravado, mesmo ETag.
    const noop = await call('POST', `/portfolios/${s.id}/finalize`, OWNER, {
      ifMatch: again.headers.etag as string,
    });
    expect(noop.statusCode).toBe(200);
    expect(noop.json<FinalizeBody>()).toMatchObject({ created: 0, ended: 0, kept: 8 });
    expect(noop.headers.etag).toBe(again.headers.etag);

    const hist = (await call('GET', `/portfolios/${s.id}/links/history?customerId=${target}`, READER)).json<
      Omit<LinkPage, 'total'>
    >();
    const inG1 = hist.items.filter((i) => i.productSubgroup.id === s.g1);
    expect(inG1.map((i) => [i.seller.id, i.active])).toEqual([
      [cur, false],
      [other, true],
    ]);
    expect(inG1[0]?.validTo).toEqual(expect.any(Number));
    const histAll = (await call('GET', `/portfolios/${s.id}/links/history`, READER)).json<LinkPage>();
    expect(histAll.items).toHaveLength(9);
    expect((await call('GET', `/portfolios/${s.id}/links`, READER)).json<LinkPage>().total).toBe(8);

    // Outbox: 8 created + 1 ended + 1 created, em ordem de id, lidos por cursor.
    const collected: EventPage['items'] = [];
    let after = 0;
    for (let guard = 0; guard < 10; guard++) {
      const res = await call('GET', `/link-events?branchId=${ser}&after=${after}&limit=4`, READER);
      expect(res.statusCode).toBe(200);
      const page = res.json<EventPage>();
      collected.push(...page.items);
      if (!page.hasMore) break;
      after = page.nextAfter as number;
    }
    expect(collected).toHaveLength(10);
    expect(collected.filter((e) => e.kind === 'created')).toHaveLength(9);
    expect(collected.filter((e) => e.kind === 'ended')).toHaveLength(1);
    const ids = collected.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    const noBranch = (await call('GET', '/link-events?limit=1000', READER)).json<EventPage>();
    expect(noBranch.items).toHaveLength(10);
    const empty = (await call('GET', `/link-events?after=${ids[9]}`, READER)).json<EventPage>();
    expect(empty).toEqual({ items: [], nextAfter: null, hasMore: false });
  });

  it('finalize incompleta: 409 portfolio_incomplete com detail, sem dados de cliente', async () => {
    const s = await setup();
    const res = await call('POST', `/portfolios/${s.id}/finalize`, OWNER, { ifMatch: s.etag });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'portfolio_incomplete', detail: { unassigned: 8, stale: 0 } });
    expect(res.body).not.toMatch(/Cliente|cnpj|legalName/);
    // Nada foi gravado e a carteira segue em rascunho.
    expect((await call('GET', `/portfolios/${s.id}/links`, READER)).json<LinkPage>().total).toBe(0);
    expect((await call('GET', `/portfolios/${s.id}`, READER)).json<{ status: string }>().status).toBe(
      'draft',
    );
  });

  it('finalize com cliente bloqueado: 409 portfolio_has_conflicts com detail.blocked', async () => {
    const hood = `Empate ${seq + 1}`;
    const p1 = await setup({ hood, name: 'Empate 1' });
    await setup({ hood, name: 'Empate 2', customers: p1.customers });
    const res = await call('POST', `/portfolios/${p1.id}/finalize`, OWNER, { ifMatch: p1.etag });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'portfolio_has_conflicts', detail: { blocked: 4 } });
    expect(res.body).not.toMatch(/Cliente|cnpj|legalName/);
  });

  it('tomada de vínculo: P vence a disputa, encerra os vínculos de Q e reporta takenOver', async () => {
    // Q (município, posto menor) finaliza primeiro; depois P (bairro, posto maior) passa a vencer os clientes.
    const hood = `Disputa ${seq + 1}`;
    const q = await setup({ hood, level: 'municipality', customers: [], name: 'Q municipio' });
    const mine = [customer(hood), customer(hood)];
    const qEtag = await distribute(q);
    const finQ = await call('POST', `/portfolios/${q.id}/finalize`, OWNER, { ifMatch: qEtag });
    expect(finQ.statusCode).toBe(200);
    expect(finQ.json<FinalizeBody>()).toMatchObject({ created: mine.length * 2, takenOver: 0 });

    const p = await setup({ hood, customers: mine, name: 'P bairro', groups: [q.g1, q.g2] });
    const pEtag = await distribute(p);
    const finP = await call('POST', `/portfolios/${p.id}/finalize`, OWNER, { ifMatch: pEtag });
    expect(finP.statusCode).toBe(200);
    const pBody = finP.json<FinalizeBody>();
    expect(pBody).toMatchObject({ created: mine.length * 2, ended: 0, takenOver: mine.length * 2 });
    expect(finP.body).not.toMatch(/Cliente|legalName/);

    // Os vínculos de Q foram encerrados; a versão (ETag) de Q mudou.
    const qLinks = (await call('GET', `/portfolios/${q.id}/links`, READER)).json<LinkPage>();
    expect(qLinks.total).toBe(0);
    const qHist = (await call('GET', `/portfolios/${q.id}/links/history`, READER)).json<LinkPage>();
    expect(qHist.items).toHaveLength(mine.length * 2);
    expect(qHist.items.every((i) => !i.active && i.validTo !== null)).toBe(true);
    const qNow = await call('GET', `/portfolios/${q.id}`, READER);
    expect(qNow.headers.etag).not.toBe(finQ.headers.etag);
    expect((await call('GET', `/portfolios/${p.id}/links`, READER)).json<LinkPage>().total).toBe(
      mine.length * 2,
    );

    // Outbox: created de Q, depois ended de Q, depois created de P.
    const ev = (await call('GET', `/link-events?branchId=${ser}&limit=1000`, READER)).json<{
      items: { id: number; kind: 'created' | 'ended'; portfolioId: number }[];
    }>();
    const seqOf = ev.items.map((e) => `${e.kind}:${e.portfolioId === q.id ? 'Q' : 'P'}`);
    const n = mine.length * 2;
    expect(seqOf).toEqual([
      ...Array<string>(n).fill('created:Q'),
      ...Array<string>(n).fill('ended:Q'),
      ...Array<string>(n).fill('created:P'),
    ]);
  });

  it('inativar a carteira volta a draft, reativar segue draft; filial inativa não finaliza', async () => {
    const s = await setup();
    const etag = await distribute(s);
    const fin = await call('POST', `/portfolios/${s.id}/finalize`, OWNER, { ifMatch: etag });
    expect(fin.statusCode).toBe(200);
    const off = await call('POST', `/portfolios/${s.id}/deactivate`, ADMIN, {
      ifMatch: fin.headers.etag as string,
    });
    expect(off.json<{ status: string }>().status).toBe('draft');
    const on = await call('POST', `/portfolios/${s.id}/reactivate`, ADMIN, {
      ifMatch: off.headers.etag as string,
    });
    expect(on.statusCode).toBe(200);
    expect(on.json<{ status: string }>().status).toBe('draft');

    fx.app.sqlite.prepare('update branches set active = 0 where id = ?').run(ser);
    const res = await call('POST', `/portfolios/${s.id}/finalize`, ADMIN, {
      ifMatch: on.headers.etag as string,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });

  it('inativar o vendedor globalmente encerra os vínculos dele e emite eventos ended', async () => {
    const s = await setup();
    const etag = await distribute(s);
    const fin = await call('POST', `/portfolios/${s.id}/finalize`, OWNER, { ifMatch: etag });
    expect(fin.statusCode).toBe(200);
    const before = (await call('GET', `/portfolios/${s.id}/links`, READER)).json<LinkPage>();
    const bySeller = before.items.filter((i) => i.seller.id === s.c).length;
    expect(bySeller).toBe(4);

    const sel = await call('GET', `/sellers/${s.c}`, ADMIN);
    expect(sel.statusCode).toBe(200);
    const off = await call('POST', `/sellers/${s.c}/deactivate-global`, ADMIN, {
      ifMatch: sel.headers.etag as string,
    });
    expect(off.statusCode).toBe(200);

    const after = (await call('GET', `/portfolios/${s.id}/links`, READER)).json<LinkPage>();
    expect(after.total).toBe(before.total - bySeller);
    const ev = (await call('GET', `/link-events?branchId=${ser}&limit=1000`, READER)).json<EventPage>();
    expect(ev.items.filter((e) => e.kind === 'ended')).toHaveLength(bySeller);
  });

  it('401, 403, 404, 428, 409 de versão e 400 de If-Match', async () => {
    const s = await setup();
    const etag = await distribute(s);
    const url = `/portfolios/${s.id}/finalize`;
    expect((await call('POST', url, null)).statusCode).toBe(401);
    expect((await call('GET', `/portfolios/${s.id}/links`, null)).statusCode).toBe(401);
    expect((await call('GET', `/portfolios/${s.id}/links/history`, null)).statusCode).toBe(401);
    expect((await call('GET', '/link-events', null)).statusCode).toBe(401);

    const forbidden = await call('POST', url, READER, { ifMatch: etag });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: 'forbidden' });

    expect((await call('POST', url, OTHER, { ifMatch: etag })).statusCode).toBe(404);
    expect((await call('GET', `/portfolios/${s.id}/links`, OTHER)).statusCode).toBe(404);
    expect((await call('GET', `/portfolios/${s.id}/links/history`, OTHER)).statusCode).toBe(404);
    expect((await call('POST', '/portfolios/99999/finalize', ADMIN, { ifMatch: '"1"' })).statusCode).toBe(
      404,
    );
    expect((await call('GET', '/portfolios/99999/links', ADMIN)).statusCode).toBe(404);
    expect((await call('POST', '/portfolios/abc/finalize', ADMIN, { ifMatch: '"1"' })).statusCode).toBe(400);

    const missing = await call('POST', url, ADMIN);
    expect(missing.statusCode).toBe(428);
    expect(missing.json()).toEqual({ error: 'precondition_required' });
    const old = await call('POST', url, ADMIN, { ifMatch: '"1"' });
    expect(old.statusCode).toBe(409);
    expect(old.json()).toEqual({ error: 'version_conflict' });
    for (const bad of ['*', 'abc', '"0"', '']) {
      expect((await call('POST', url, ADMIN, { ifMatch: bad })).statusCode).toBe(400);
    }
  });

  it('carteira inativa dá 409 portfolio_inactive e a inativação encerra os vínculos', async () => {
    const s = await setup();
    const etag = await distribute(s);
    const fin = await call('POST', `/portfolios/${s.id}/finalize`, OWNER, { ifMatch: etag });
    expect(fin.statusCode).toBe(200);
    const off = await call('POST', `/portfolios/${s.id}/deactivate`, ADMIN, {
      ifMatch: fin.headers.etag as string,
    });
    expect(off.statusCode).toBe(200);
    expect((await call('GET', `/portfolios/${s.id}/links`, READER)).json<LinkPage>().total).toBe(0);
    const hist = (await call('GET', `/portfolios/${s.id}/links/history`, READER)).json<LinkPage>();
    expect(hist.items).toHaveLength(8);
    expect(hist.items.every((i) => !i.active && i.validTo !== null)).toBe(true);
    const res = await call('POST', `/portfolios/${s.id}/finalize`, ADMIN, {
      ifMatch: off.headers.etag as string,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'portfolio_inactive' });
  });

  it('link-events: branchId fora do token ou inexistente dá 404; query inválida dá 400', async () => {
    expect((await call('GET', `/link-events?branchId=${ser}`, OTHER)).statusCode).toBe(404);
    expect((await call('GET', '/link-events?branchId=99999', ADMIN)).statusCode).toBe(404);
    const other = (await call('GET', '/link-events', OTHER)).json<EventPage>();
    expect(other.items).toEqual([]);
    for (const qs of ['limit=0', 'limit=1001', 'after=-1', 'branchId=0', 'after=x']) {
      expect((await call('GET', `/link-events?${qs}`, ADMIN)).statusCode).toBe(400);
    }
    const s = await setup();
    for (const qs of ['limit=0', 'cursor=!!'.repeat(40), 'productSubgroupId=0', 'sellerId=a']) {
      expect((await call('GET', `/portfolios/${s.id}/links?${qs}`, READER)).statusCode).toBe(400);
    }
    for (const qs of ['customerId=0', 'limit=201']) {
      expect((await call('GET', `/portfolios/${s.id}/links/history?${qs}`, READER)).statusCode).toBe(400);
    }
  });
});
