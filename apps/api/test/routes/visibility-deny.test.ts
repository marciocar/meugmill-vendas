import { afterEach, describe, expect, it } from 'vitest';
import { makeRoutesFixture, type RoutesFixture } from '../helpers/jwt.js';
import { v1Routes } from '../../src/routes/v1/index.js';
import { ES, SERRA, seedBranch } from '../helpers/seed.js';

const NOW = 1_700_000_000_000;
const NO_PROFILE = { sub: 'sem-perfil-1', roles: ['leitor'], branches: ['FA'] };

let t: RoutesFixture;

async function boot(env: NodeJS.ProcessEnv): Promise<number> {
  t = await makeRoutesFixture(v1Routes, '/v1', env);
  const fa = seedBranch(t.db, 'FA');
  const id = t.app.sqlite
    .prepare(
      `insert into customers (cnpj, legal_name, legal_name_key, state_code, municipality_code, neighborhood,
        neighborhood_key, active, created_at, updated_at, created_by, updated_by)
       values ('00000000000001','Cliente 1','CLIENTE 1',?,?,'Centro','CENTRO',1,?,?,'t','t')`,
    )
    .run(ES, SERRA, NOW, NOW).lastInsertRowid as number;
  t.app.sqlite
    .prepare('insert into customer_branches (customer_id, branch_id, active) values (?,?,1)')
    .run(id, fa);
  return id;
}
const get = async (url: string) => t.app.inject({ method: 'GET', url, headers: await t.headers(NO_PROFILE) });

afterEach(async () => {
  await t.app.close();
});

describe('HTTP: VISIBILITY_LEGACY', () => {
  it('deny: token sem perfil não lê nada amplo e /me/visibility informa denied', async () => {
    const id = await boot({ VISIBILITY_LEGACY: 'deny' });
    expect((await get('/v1/me/customers')).json()).toMatchObject({ items: [], total: 0 });
    expect(await get('/v1/me/visibility').then((r) => r.json())).toMatchObject({
      mode: 'denied',
      visibleCustomers: 0,
    });
    expect((await get('/v1/customers')).json()).toMatchObject({ items: [] });
    expect((await get(`/v1/customers/${id}`)).statusCode).toBe(404);
    expect(t.logs.join('')).not.toContain('legacy_access');
  });

  it('allow (e o default): lê a filial como antes', async () => {
    for (const env of [{ VISIBILITY_LEGACY: 'allow' }, {}]) {
      const id = await boot(env);
      expect(((await get('/v1/me/customers')).json() as { total: number }).total).toBe(1);
      expect((await get(`/v1/customers/${id}`)).statusCode).toBe(200);
      expect(((await get('/v1/me/visibility')).json() as { mode: string }).mode).toBe('legacy');
      await t.app.close();
    }
    t = await makeRoutesFixture(v1Routes); // para o afterEach
  });
});
