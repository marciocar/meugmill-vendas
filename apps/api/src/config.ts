import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

// Listas (OIDC_ALGORITHMS, CORS_ORIGINS) chegam como string separada por vírgula e são
// convertidas em array por loadConfig depois da validação do schema.
const ConfigSchema = Type.Object({
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  HOST: Type.String({ minLength: 1, default: '0.0.0.0' }),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal('fatal'),
      Type.Literal('error'),
      Type.Literal('warn'),
      Type.Literal('info'),
      Type.Literal('debug'),
      Type.Literal('trace'),
      Type.Literal('silent'),
    ],
    { default: 'info' },
  ),
  // Caminho do arquivo SQLite; ':memory:' é aceito (testes).
  DATABASE_PATH: Type.String({ minLength: 1, default: './data/carteira.sqlite' }),
  NODE_ENV: Type.Union([Type.Literal('development'), Type.Literal('test'), Type.Literal('production')], {
    default: 'development',
  }),
  // Validação de JWT: sem OIDC_ISSUER/OIDC_AUDIENCE a API não sobe (falha fechada).
  OIDC_ISSUER: Type.String({ minLength: 1 }),
  OIDC_AUDIENCE: Type.String({ minLength: 1 }),
  // Se ausente, o jwks_uri é descoberto em `${OIDC_ISSUER}/.well-known/openid-configuration`.
  OIDC_JWKS_URI: Type.Optional(Type.String({ minLength: 1 })),
  // Fora de dev, issuer e jwks_uri precisam ser https. Só ligue em dev/Compose (IdP local em http).
  OIDC_ALLOW_INSECURE_HTTP: Type.Boolean({ default: false }),
  OIDC_ALGORITHMS: Type.String({ default: 'RS256,ES256' }),
  // [INFERIDO] Os nomes de claims abaixo são hipótese provisória do cliente; confirmar com o IdP da GMill.
  // Ver docs/business-context/02-product/features/carteira-de-clientes-hipoteses.md (tema "Claims").
  OIDC_CLAIM_ROLES: Type.String({ minLength: 1, default: 'roles' }),
  OIDC_CLAIM_BRANCHES: Type.String({ minLength: 1, default: 'branch_ids' }),
  OIDC_CLOCK_TOLERANCE_SECONDS: Type.Integer({ minimum: 0, maximum: 300, default: 30 }),
  // Vazio = nenhuma origem cruzada liberada. [TO BE COMPLETED] origens de homologação/produção.
  CORS_ORIGINS: Type.String({ default: '' }),
});

type RawConfig = Static<typeof ConfigSchema>;

export type AppConfig = Omit<RawConfig, 'OIDC_ALGORITHMS' | 'CORS_ORIGINS'> & {
  OIDC_ALGORITHMS: string[];
  CORS_ORIGINS: string[];
};

// Allowlist: apenas assimétricos. `none` e HS* (segredo compartilhado) nunca são aceitos.
const ALLOWED_ALGORITHMS = new Set([
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
]);

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuração inválida:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

function isHttpUrl(value: string): boolean {
  return httpProtocol(value) !== null;
}

// Retorna o protocolo (http:/https:) ou null se a URL for inválida ou de outro esquema.
function httpProtocol(value: string): 'http:' | 'https:' | null {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? protocol : null;
  } catch {
    return null;
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(ConfigSchema.properties)) {
    const value = source[key];
    if (value !== undefined && value !== '') raw[key] = value;
  }

  // Aplica defaults e converte strings para o tipo do schema; valores inconvertíveis
  // permanecem como estão e falham na validação, citando a variável.
  const candidate = Value.Convert(ConfigSchema, Value.Default(ConfigSchema, raw));

  if (!Value.Check(ConfigSchema, candidate)) {
    const issues = [...Value.Errors(ConfigSchema, candidate)].map(
      (e) => `${e.path.replace(/^\//, '') || '(raiz)'}: ${e.message}`,
    );
    throw new ConfigError(issues);
  }

  const issues: string[] = [];
  if (!isHttpUrl(candidate.OIDC_ISSUER)) issues.push('OIDC_ISSUER: deve ser uma URL http(s)');
  if (candidate.OIDC_JWKS_URI !== undefined && !isHttpUrl(candidate.OIDC_JWKS_URI)) {
    issues.push('OIDC_JWKS_URI: deve ser uma URL http(s)');
  }
  if (!candidate.OIDC_ALLOW_INSECURE_HTTP) {
    const hint = 'use https ou, apenas em desenvolvimento, OIDC_ALLOW_INSECURE_HTTP=true';
    if (httpProtocol(candidate.OIDC_ISSUER) === 'http:')
      issues.push(`OIDC_ISSUER: http não é permitido; ${hint}`);
    if (candidate.OIDC_JWKS_URI !== undefined && httpProtocol(candidate.OIDC_JWKS_URI) === 'http:') {
      issues.push(`OIDC_JWKS_URI: http não é permitido; ${hint}`);
    }
  }

  const algorithms = splitList(candidate.OIDC_ALGORITHMS);
  if (algorithms.length === 0) issues.push('OIDC_ALGORITHMS: informe ao menos um algoritmo');
  for (const alg of algorithms) {
    if (!ALLOWED_ALGORITHMS.has(alg)) {
      issues.push(`OIDC_ALGORITHMS: algoritmo não permitido "${alg}" (none e HS* são proibidos)`);
    }
  }

  const corsOrigins = splitList(candidate.CORS_ORIGINS);
  for (const origin of corsOrigins) {
    if (origin === '*' || !isHttpUrl(origin)) {
      issues.push(`CORS_ORIGINS: origem inválida "${origin}" (use origens explícitas, sem curinga)`);
    } else if (new URL(origin).origin !== origin) {
      issues.push(
        `CORS_ORIGINS: "${origin}" deve ser exatamente uma origem (esquema://host[:porta], sem barra final, caminho, query ou fragmento)`,
      );
    }
  }

  if (issues.length > 0) throw new ConfigError(issues);

  return { ...candidate, OIDC_ALGORITHMS: algorithms, CORS_ORIGINS: corsOrigins };
}
