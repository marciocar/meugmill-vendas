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
      OIDC_ALLOW_INSECURE_HTTP: false,
      OIDC_ALGORITHMS: ['RS256', 'ES256'],
      OIDC_CLAIM_ROLES: 'roles',
      OIDC_CLAIM_BRANCHES: 'branch_ids',
      OIDC_CLOCK_TOLERANCE_SECONDS: 30,
      CORS_ORIGINS: [],
      VISIBILITY_LEGACY: 'allow',
    });
  });

  it('VISIBILITY_LEGACY aceita allow e deny; outro valor é inválido', () => {
    expect(loadConfig({ ...OIDC, VISIBILITY_LEGACY: 'deny' }).VISIBILITY_LEGACY).toBe('deny');
    expect(loadConfig({ ...OIDC, VISIBILITY_LEGACY: 'allow' }).VISIBILITY_LEGACY).toBe('allow');
    expect(() => loadConfig({ ...OIDC, VISIBILITY_LEGACY: 'talvez' })).toThrow(/VISIBILITY_LEGACY/);
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

  it('exige https em issuer e jwks_uri por padrão', () => {
    expect(() => loadConfig({ OIDC_ISSUER: 'http://idp.test', OIDC_AUDIENCE: 'x' })).toThrow(
      /OIDC_ISSUER: http não é permitido/,
    );
    expect(() => loadConfig({ ...OIDC, OIDC_JWKS_URI: 'http://idp.test/jwks' })).toThrow(
      /OIDC_JWKS_URI: http não é permitido/,
    );
    expect(() => loadConfig({ ...OIDC, OIDC_JWKS_URI: 'https://idp.test/jwks' })).not.toThrow();
  });

  it('OIDC_ALLOW_INSECURE_HTTP=true aceita http', () => {
    const cfg = loadConfig({
      OIDC_ISSUER: 'http://idp.local',
      OIDC_AUDIENCE: 'x',
      OIDC_JWKS_URI: 'http://idp.local/jwks',
      OIDC_ALLOW_INSECURE_HTTP: 'true',
    });
    expect(cfg.OIDC_ALLOW_INSECURE_HTTP).toBe(true);
  });

  it.each([
    'https://app.test/',
    'https://app.test/caminho',
    'https://app.test?x=1',
    'https://app.test#frag',
    'https://app.test/?x=1',
  ])('rejeita CORS_ORIGINS que não é exatamente uma origem (%s)', (origin) => {
    expect(() => loadConfig({ ...OIDC, CORS_ORIGINS: origin })).toThrow(
      /CORS_ORIGINS.*exatamente uma origem/,
    );
  });

  it('aceita origem com porta em CORS_ORIGINS', () => {
    expect(loadConfig({ ...OIDC, CORS_ORIGINS: 'http://localhost:5173' }).CORS_ORIGINS).toEqual([
      'http://localhost:5173',
    ]);
  });
});
