import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const OIDC = { OIDC_ISSUER: 'https://idp.test', OIDC_AUDIENCE: 'meugmill' };

describe('loadConfig', () => {
  it('aplica os defaults', () => {
    expect(loadConfig({ ...OIDC })).toEqual({
      PORT: 3000,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'info',
      DATABASE_PATH: './data/carteira.sqlite',
      NODE_ENV: 'development',
      OIDC_ISSUER: 'https://idp.test',
      OIDC_AUDIENCE: 'meugmill',
      OIDC_ALGORITHMS: ['RS256', 'ES256'],
      OIDC_CLAIM_ROLES: 'roles',
      OIDC_CLAIM_BRANCHES: 'branch_ids',
      OIDC_CLOCK_TOLERANCE_SECONDS: 30,
      CORS_ORIGINS: [],
    });
  });

  it('converte PORT numérica', () => {
    expect(loadConfig({ ...OIDC, PORT: '8080' }).PORT).toBe(8080);
  });

  it('aceita DATABASE_PATH customizado e :memory:', () => {
    expect(loadConfig({ ...OIDC, DATABASE_PATH: ':memory:' }).DATABASE_PATH).toBe(':memory:');
  });

  it('lança erro listando a variável inválida', () => {
    expect(() => loadConfig({ ...OIDC, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...OIDC, LOG_LEVEL: 'xyz' })).toThrow(/LOG_LEVEL/);
  });

  it('exige OIDC_ISSUER e OIDC_AUDIENCE (falha fechada)', () => {
    expect(() => loadConfig({})).toThrow(/OIDC_ISSUER/);
    expect(() => loadConfig({ OIDC_ISSUER: 'https://idp.test' })).toThrow(/OIDC_AUDIENCE/);
    expect(() => loadConfig({ OIDC_ISSUER: 'não-é-url', OIDC_AUDIENCE: 'x' })).toThrow(/OIDC_ISSUER/);
    expect(() => loadConfig({ ...OIDC, OIDC_JWKS_URI: 'ftp://x' })).toThrow(/OIDC_JWKS_URI/);
  });

  it('converte listas separadas por vírgula, ignorando espaços', () => {
    const cfg = loadConfig({
      ...OIDC,
      OIDC_ALGORITHMS: 'ES256, RS512',
      CORS_ORIGINS: 'http://localhost:5173, https://app.test',
    });
    expect(cfg.OIDC_ALGORITHMS).toEqual(['ES256', 'RS512']);
    expect(cfg.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.test']);
  });

  it('rejeita none, HS* e algoritmos desconhecidos', () => {
    for (const alg of ['none', 'HS256', 'RS256,HS512', 'foo']) {
      expect(() => loadConfig({ ...OIDC, OIDC_ALGORITHMS: alg })).toThrow(/OIDC_ALGORITHMS/);
    }
  });

  it('rejeita CORS com curinga ou origem inválida', () => {
    expect(() => loadConfig({ ...OIDC, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ ...OIDC, CORS_ORIGINS: 'localhost' })).toThrow(/CORS_ORIGINS/);
  });

  it('aceita claims e tolerância customizadas', () => {
    const cfg = loadConfig({
      ...OIDC,
      OIDC_CLAIM_ROLES: 'perfis',
      OIDC_CLAIM_BRANCHES: 'filiais',
      OIDC_CLOCK_TOLERANCE_SECONDS: '5',
    });
    expect(cfg).toMatchObject({
      OIDC_CLAIM_ROLES: 'perfis',
      OIDC_CLAIM_BRANCHES: 'filiais',
      OIDC_CLOCK_TOLERANCE_SECONDS: 5,
    });
  });
});
