import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v1Routes } from '../../src/routes/v1/index.js';
import { makeRoutesFixture, type RoutesFixture } from '../helpers/jwt.js';
import { seedBranch, SERRA } from '../helpers/seed.js';
import { crudContract } from './crud-contract.js';

const CODES = ['A1', 'M1', 'P1', 'D1', 'G1', 'G2', 'G3'];

crudContract({
  name: 'branches',
  path: 'branches',
  body: (code) => ({ code, name: `Filial ${code}`, municipalityCode: SERRA }),
  patch: { name: 'Filial alterada' },
  admin: { roles: ['admin'], branches: CODES },
  reader: { roles: ['vendedor'], branches: CODES },
});

describe('escopo de filiais no HTTP', () => {
  let fx: RoutesFixture;
  let outsideId: number;
  beforeAll(async () => {
    fx = await makeRoutesFixture(v1Routes);
    outsideId = seedBranch(fx.db, 'FORA');
  });
  afterAll(() => fx.close());

  it('GET de filial fora do token -> 404', async () => {
    const res = await fx.app.inject({
      method: 'GET',
      url: `/v1/branches/${outsideId}`,
      headers: await fx.headers({ roles: ['admin'], branches: ['OUTRA'] }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('criar filial fora do token -> 403 sem eco', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/v1/branches',
      headers: await fx.headers({ roles: ['admin'], branches: ['OUTRA'] }),
      payload: { code: 'NOVA-XYZ', name: 'Nova', municipalityCode: SERRA },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
    expect(res.body).not.toContain('NOVA-XYZ');
  });

  it('município inexistente -> 400 sem eco', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/v1/branches',
      headers: await fx.headers({ roles: ['admin'], branches: ['NOVA'] }),
      payload: { code: 'NOVA', name: 'Nova', municipalityCode: 987654321 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('987654321');
  });

  it('lista só traz as filiais do token', async () => {
    const res = await fx.app.inject({
      method: 'GET',
      url: '/v1/branches',
      headers: await fx.headers({ roles: ['vendedor'], branches: ['FORA'] }),
    });
    expect(res.json<{ items: { code: string }[] }>().items.map((b) => b.code)).toEqual(['FORA']);
    const none = await fx.app.inject({
      method: 'GET',
      url: '/v1/branches',
      headers: await fx.headers({ roles: ['vendedor'], branches: [] }),
    });
    expect(none.json()).toEqual({ items: [], nextCursor: null });
  });
});
