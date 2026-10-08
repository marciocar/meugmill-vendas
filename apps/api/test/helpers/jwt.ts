import { SignJWT, generateKeyPair } from 'jose';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import { loadConfig } from '../../src/config.js';
import type { Db } from '../../src/domain/shared/db.js';
import { authPlugin } from '../../src/plugins/auth.js';
import { dbPlugin } from '../../src/plugins/db.js';
import { buildLoggerOptions, genReqId, observabilityPlugin } from '../../src/plugins/observability.js';

const ISSUER = 'https://idp.test';
const AUDIENCE = 'meugmill';

export interface TokenOptions {
  sub?: string;
  /** Perfis (default: `['vendedor']`, sem poder de escrita). */
  roles?: string[];
  /** Códigos de filial do token. */
  branches?: string[];
}

export interface RoutesFixture {
  app: FastifyInstance;
  db: Db;
  /** Linhas de log capturadas (texto bruto), para checar que não vaza PII. */
  logs: string[];
  /** Gera um JWT válido assinado com a chave local do fixture. */
  token(opts?: TokenOptions): Promise<string>;
  /** Cabeçalhos prontos: `Authorization` (+ `If-Match` opcional). */
  headers(opts?: TokenOptions & { ifMatch?: string }): Promise<Record<string, string>>;
  close(): Promise<void>;
}

/**
 * Monta um app de teste com observabilidade, banco em memória e auth (chave local, sem JWKS remota)
 * e registra SÓ o plugin de rotas recebido sob `prefix` (default `/v1`), sem depender de `app.ts`.
 */
export async function makeRoutesFixture(
  routes: FastifyPluginAsync,
  prefix = '/v1',
  env: NodeJS.ProcessEnv = {},
): Promise<RoutesFixture> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const config = loadConfig({
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    OIDC_ISSUER: ISSUER,
    OIDC_AUDIENCE: AUDIENCE,
    ...env,
  });
  const logs: string[] = [];
  const app = Fastify({
    logger: buildLoggerOptions(config, { write: (chunk) => void logs.push(chunk) }),
    requestIdHeader: false,
    genReqId,
  });
  await app.register(observabilityPlugin);
  await app.register(dbPlugin, { config });
  await app.register(authPlugin, { config, keyGetter: async () => publicKey });
  await app.register(routes, { prefix });
  await app.ready();

  const token = (opts: TokenOptions = {}): Promise<string> =>
    new SignJWT({ roles: opts.roles ?? ['vendedor'], branch_ids: opts.branches ?? [] })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(opts.sub ?? 'user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  return {
    app,
    db: app.db,
    logs,
    token,
    async headers(opts = {}) {
      return {
        authorization: `Bearer ${await token(opts)}`,
        ...(opts.ifMatch !== undefined ? { 'if-match': opts.ifMatch } : {}),
      };
    },
    close: () => app.close(),
  };
}

export const ADMIN: TokenOptions = { roles: ['admin'], branches: [] };
export const READER: TokenOptions = { roles: ['vendedor'], branches: [] };
