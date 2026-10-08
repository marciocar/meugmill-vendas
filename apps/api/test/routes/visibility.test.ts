import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeRoutesFixture, type RoutesFixture } from '../helpers/jwt.js';
import { v1Routes } from '../../src/routes/v1/index.js';
import { ES, SERRA, seedBranch } from '../helpers/seed.js';

const NOW = 1_700_000_000_000;

let t: RoutesFixture;
let sellerOne: number;
let c: Record<'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6', number>;
let p1: number;
let sub1: number;

const SELLER = { sub: 'vend-1', roles: ['vendedor'], branches: ['FA'] };
const MANAGER = { sub: 'gest-1', roles: ['gestor'], branches: ['FA'] };
const SUPERVISION = { sub: 'sup-1', roles: ['supervisao'], branches: ['FA'] };
const ADMIN = { sub: 'adm-1', roles: ['admin'], branches: ['FA'] };
const LEGACY = { sub: 'legacy-sub-xyz', roles: ['leitor'], branches: ['FA'] };

beforeEach(async () => {
  t = await makeRoutesFixture(v1Routes);
  const sq = t.app.sqlite;
  const fa = seedBranch(t.db, 'FA');
  const fb = seedBranch(t.db, 'FB');
  const typeId = sq
    .prepare(
      `insert into portfolio_types (code, name, name_key, created_at, updated_at, created_by, updated_by)
       values ('T','Tipo','TIPO',?,?,'t','t')`,
    )
    .run(NOW, NOW).lastInsertRowid as number;
  const insP = sq.prepare(
    `insert into portfolios (branch_id, name, name_key, responsible_sub, portfolio_type_id, status, active,
      created_at, updated_at, created_by, updated_by) values (?,?,?,?,?,'active',1,?,?,'t','t')`,
  );
  p1 = insP.run(fa, 'P1', 'P1', 'gest-1', typeId, NOW, NOW).lastInsertRowid as number;
  const p2 = insP.run(fa, 'P2', 'P2', 'outro-gestor', typeId, NOW, NOW).lastInsertRowid as number;
  sub1 = sq
    .prepare(
      `insert into product_subgroups (code, name, name_key, created_at, updated_at, created_by, updated_by)
       values ('G1','Subgrupo','G1',?,?,'t','t')`,
    )
    .run(NOW, NOW).lastInsertRowid as number;
  const insS = sq.prepare(
    `insert into sellers (code, name, name_key, user_sub, created_at, updated_at, created_by, updated_by)
     values (?,?,?,?,?,?,'t','t')`,
  );
  sellerOne = insS.run('V1', 'Vendedor 1', 'V1', 'vend-1', NOW, NOW).lastInsertRowid as number;
  const sellerTwo = insS.run('V2', 'Vendedor 2', 'V2', 'vend-2', NOW, NOW).lastInsertRowid as number;
  for (const s of [sellerOne, sellerTwo]) {
    sq.prepare('insert into seller_branches (seller_id, branch_id, active) values (?,?,1)').run(s, fa);
  }
  const insC = sq.prepare(
    `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
      neighborhood_key, active, created_at, updated_at, created_by, updated_by)
     values (?,?,?,?,?,'Centro','CENTRO',1,?,?,'t','t')`,
  );
  const insB = sq.prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,1)');
  const mk = (n: number, branch: number): number => {
    const id = insC.run(String(n).padStart(14, '0'), `Cliente ${n}`, `CLIENTE ${n}`, ES, SERRA, NOW, NOW)
      .lastInsertRowid as number;
    insB.run(id, branch);
    return id;
  };
  c = { c1: mk(1, fa), c2: mk(2, fa), c3: mk(3, fa), c4: mk(4, fa), c5: mk(5, fa), c6: mk(6, fb) };
  const insL = sq.prepare(
    `insert into portfolio_links (portfolio_id, branch_id, customer_id, product_subgroup_id, seller_id, active,
      valid_from, created_by) values (?,?,?,?,?,1,?,'t')`,
  );
  insL.run(p1, fa, c.c1, sub1, sellerOne, NOW);
  insL.run(p1, fa, c.c2, sub1, sellerOne, NOW);
  insL.run(p1, fa, c.c3, sub1, sellerTwo, NOW);
  insL.run(p2, fa, c.c4, sub1, sellerTwo, NOW);
});
afterEach(async () => {
  await t.app.close();
});

type Who = { sub: string; roles: string[]; branches: string[] };

async function get(url: string, who: Who) {
  return t.app.inject({ method: 'GET', url, headers: await t.headers(who) });
}
async function check(ids: unknown, who: Who) {
  return t.app.inject({
    method: 'POST',
    url: '/v1/visibility/check',
    headers: await t.headers(who),
    payload: { customerIds: ids },
  });
}
const idsOf = (res: { json(): unknown }): number[] =>
  (res.json() as { items: { id: number }[] }).items.map((i) => i.id);

describe('HTTP: GET /v1/me/customers e /v1/me/visibility', () => {
  it('vendedor com userSub vê só os clientes dos seus vínculos ativos, com via', async () => {
    const res = await get('/v1/me/customers', SELLER);
    expect(res.statusCode).toBe(200);
    expect(idsOf(res)).toEqual([c.c1, c.c2]);
    const body = res.json() as { total: number; items: { via: unknown[] }[] };
    expect(body.total).toBe(2);
    expect(body.items[0]?.via).toEqual([{ productSubgroupId: sub1, portfolioId: p1, profile: 'vendedor' }]);

    const summary = await get('/v1/me/visibility', SELLER);
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      profiles: ['vendedor'],
      mode: 'profiles',
      seller: { id: sellerOne, code: 'V1' },
      visibleCustomers: 2,
    });
  });

  it('filtros e paginação: productSubgroupId, q e cursor', async () => {
    expect(idsOf(await get(`/v1/me/customers?productSubgroupId=${sub1}`, SELLER))).toEqual([c.c1, c.c2]);
    expect(idsOf(await get('/v1/me/customers?productSubgroupId=99999', SELLER))).toEqual([]);
    expect(idsOf(await get('/v1/me/customers?q=Cliente 2', SELLER))).toEqual([c.c2]);
    const first = await get('/v1/me/customers?limit=1', SELLER);
    const page = first.json() as { nextCursor: string | null };
    expect(idsOf(first)).toEqual([c.c1]);
    expect(page.nextCursor).toBeTruthy();
    const second = await get(`/v1/me/customers?limit=1&cursor=${page.nextCursor}`, SELLER);
    expect(idsOf(second)).toEqual([c.c2]);
    expect((await get('/v1/me/customers?limit=0', SELLER)).statusCode).toBe(400);
  });

  it('gestor vê os clientes das carteiras em que é responsável', async () => {
    const res = await get('/v1/me/customers', MANAGER);
    expect(idsOf(res)).toEqual([c.c1, c.c2, c.c3]);
    expect((res.json() as { items: { via: { profile: string }[] }[] }).items[0]?.via[0]?.profile).toBe(
      'gestor',
    );
  });

  it('supervisão vê a filial inteira (sem a outra filial) e não escreve', async () => {
    const res = await get('/v1/me/customers', SUPERVISION);
    expect(idsOf(res)).toEqual([c.c1, c.c2, c.c3, c.c4, c.c5]);
    const write = await t.app.inject({
      method: 'POST',
      url: '/v1/product-subgroups',
      headers: await t.headers(SUPERVISION),
      payload: { code: 'X1', name: 'Novo' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('legacy (token sem perfil) lê como antes e gera aviso sem o sub', async () => {
    const res = await get('/v1/me/customers', LEGACY);
    expect(res.statusCode).toBe(200);
    expect(idsOf(res)).toEqual([c.c1, c.c2, c.c3, c.c4, c.c5]);
    expect(((await get('/v1/me/visibility', LEGACY)).json() as { mode: string }).mode).toBe('legacy');
    const warns = t.logs.filter((l) => l.includes('legacy_access'));
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toContain('"resource":"visibility"');
    expect(warns.join('')).not.toContain(LEGACY.sub);
  });

  it('401 sem token', async () => {
    for (const url of ['/v1/me/customers', '/v1/me/visibility']) {
      expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
    const anon = await t.app.inject({
      method: 'POST',
      url: '/v1/visibility/check',
      payload: { customerIds: [1] },
    });
    expect(anon.statusCode).toBe(401);
  });
});

describe('HTTP: POST /v1/visibility/check', () => {
  it('devolve só os visíveis, sem diferenciar invisíveis de inexistentes', async () => {
    const res = await check([c.c1, c.c3, c.c5, c.c6, 999999], SELLER);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ visible: [c.c1] });
    const onlyInvisible = await check([c.c3, 999999], SELLER);
    expect(onlyInvisible.json()).toEqual({ visible: [] });
    expect((await check([], SELLER)).json()).toEqual({ visible: [] });
  });

  it('lista com mais de 1.000 ids ou com ids repetidos é 400', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => i + 1);
    expect((await check(many, SELLER)).statusCode).toBe(400);
    expect((await check(many.slice(0, 1000), SELLER)).statusCode).toBe(200);
    expect((await check([c.c1, c.c1], SELLER)).statusCode).toBe(400);
    expect((await check([0], SELLER)).statusCode).toBe(400);
  });
});

describe('HTTP: userSub na leitura de vendedor', () => {
  it('aparece para admin e não para supervisão', async () => {
    const asAdmin = await get(`/v1/sellers/${sellerOne}`, ADMIN);
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json()).toMatchObject({ userSub: 'vend-1' });
    const asSupervision = await get(`/v1/sellers/${sellerOne}`, SUPERVISION);
    expect(asSupervision.statusCode).toBe(200);
    expect(asSupervision.json()).not.toHaveProperty('userSub');
  });

  it('o PATCH da rota aceita userSub (grava, limpa e barra duplicado)', async () => {
    const patch = async (userSub: string | null) =>
      t.app.inject({
        method: 'PATCH',
        url: `/v1/sellers/${sellerOne}`,
        headers: await t.headers({ ...ADMIN, ifMatch: `"${await versionOf()}"` }),
        payload: { userSub },
      });
    const versionOf = async (): Promise<number> =>
      ((await get(`/v1/sellers/${sellerOne}`, ADMIN)).json() as { version: number }).version;
    expect((await patch('vend-2')).statusCode).toBe(409);
    const cleared = await patch(null);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ userSub: null });
    expect(idsOf(await get('/v1/me/customers', SELLER))).toEqual([]);
    expect((await patch('vend-1')).statusCode).toBe(200);
    expect(idsOf(await get('/v1/me/customers', SELLER))).toEqual([c.c1, c.c2]);
  });
});
