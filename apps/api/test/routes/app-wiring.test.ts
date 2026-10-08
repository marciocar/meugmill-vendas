import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

const ISSUER = 'https://idp.test';
const AUDIENCE = 'meugmill';

const PATHS = [
  '/v1/product-subgroups',
  '/v1/retail-networks',
  '/v1/economic-groups',
  '/v1/branches',
  '/v1/geo/states',
  '/v1/sellers',
  '/v1/customers',
  '/v1/portfolio-types',
  '/v1/portfolios',
];

describe('buildApp: rotas v1 registradas', () => {
  let app: FastifyInstance;
  let auth: { authorization: string };

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }],
    });
    const config = loadConfig({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: AUDIENCE,
    });
    app = buildApp(config, { keyGetter: jwks });
    await app.ready();
    const jwt = await new SignJWT({ roles: ['vendedor'], branch_ids: [] })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('leitor-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    auth = { authorization: `Bearer ${jwt}` };
  });
  afterAll(() => app.close());

  it.each(PATHS)('%s: 401 sem token e 200 com token de leitor', async (url) => {
    const anon = await app.inject({ method: 'GET', url });
    expect(anon.statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url, headers: auth });
    expect(ok.statusCode).toBe(200);
  });

  it('/v1/me segue respondendo 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sub: 'leitor-1', roles: ['vendedor'] });
  });
});
