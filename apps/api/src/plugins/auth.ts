import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { UserClaims } from '@meugmill/shared';
import type { AppConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: UserClaims;
  }
}

export type AuthConfig = Pick<
  AppConfig,
  | 'OIDC_ISSUER'
  | 'OIDC_AUDIENCE'
  | 'OIDC_JWKS_URI'
  | 'OIDC_ALLOW_INSECURE_HTTP'
  | 'OIDC_ALGORITHMS'
  | 'OIDC_CLAIM_ROLES'
  | 'OIDC_CLAIM_BRANCHES'
  | 'OIDC_CLOCK_TOLERANCE_SECONDS'
>;

export interface AuthPluginOptions {
  config: AuthConfig;
  /** Substitui a busca da JWKS (uso em testes). */
  keyGetter?: JWTVerifyGetKey;
  /** Intervalo sem nova tentativa de discovery após uma falha (default 10s; injetável em testes). */
  discoveryCooldownMs?: number;
}

const FETCH_TIMEOUT_MS = 5000;
const DEFAULT_DISCOVERY_COOLDOWN_MS = 10_000;

// Erros que significam "token ruim" (401). Qualquer outro erro (rede, JWKS inválida,
// timeout, falha inesperada) vira 503: a requisição nunca passa.
function isTokenError(err: unknown): boolean {
  return (
    err instanceof errors.JWTExpired ||
    err instanceof errors.JWTClaimValidationFailed ||
    err instanceof errors.JWTInvalid ||
    err instanceof errors.JWSInvalid ||
    err instanceof errors.JWSSignatureVerificationFailed ||
    err instanceof errors.JOSEAlgNotAllowed ||
    err instanceof errors.JOSENotSupported ||
    err instanceof errors.JWKSNoMatchingKey ||
    err instanceof errors.JWKSMultipleMatchingKeys
  );
}

// Descobre o jwks_uri (se não configurado) de forma lazy e guarda o key getter. Falhas não são
// cacheadas como sucesso, mas respeitam um cooldown: dentro dele a falha anterior é repetida na hora,
// sem nova ida ao IdP.
function remoteKeyGetter(
  config: AuthConfig,
  cooldownMs: number,
  log: { error: (obj: object, msg: string) => void },
): JWTVerifyGetKey {
  let getter: JWTVerifyGetKey | undefined;
  let pending: Promise<JWTVerifyGetKey> | undefined;
  let lastFailure: { at: number; error: Error } | undefined;

  async function resolve(): Promise<JWTVerifyGetKey> {
    let uri = config.OIDC_JWKS_URI;
    if (uri === undefined) {
      const discovery = `${config.OIDC_ISSUER.replace(/\/+$/, '')}/.well-known/openid-configuration`;
      const res = await fetch(discovery, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Discovery OIDC respondeu ${res.status}`);
      const doc = (await res.json()) as { jwks_uri?: unknown };
      if (typeof doc.jwks_uri !== 'string') throw new Error('Discovery OIDC sem jwks_uri');
      uri = doc.jwks_uri;
      // O jwks_uri vem de fora (discovery): aplica a mesma regra de https da configuração.
      if (!config.OIDC_ALLOW_INSECURE_HTTP && new URL(uri).protocol !== 'https:') {
        log.error({ reason: 'discovery_jwks_uri_not_https' }, 'jwks_uri do discovery rejeitado: não é https');
        throw new Error('jwks_uri do discovery não é https');
      }
    }
    return createRemoteJWKSet(new URL(uri), { timeoutDuration: FETCH_TIMEOUT_MS });
  }

  return async (protectedHeader, token) => {
    if (!getter) {
      if (lastFailure && Date.now() - lastFailure.at < cooldownMs) throw lastFailure.error;
      pending ??= resolve()
        .catch((err: unknown) => {
          lastFailure = {
            at: Date.now(),
            error: err instanceof Error ? err : new Error('Falha no discovery'),
          };
          throw err;
        })
        .finally(() => {
          pending = undefined;
        });
      getter = await pending;
      lastFailure = undefined;
    }
    return getter(protectedHeader, token);
  };
}

function toStringList(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v !== '');
  return [];
}

// Minimização (LGPD): só sub, perfis e filiais; o resto do payload é descartado.
function extractClaims(payload: JWTPayload, config: AuthConfig): UserClaims | null {
  if (typeof payload.sub !== 'string' || payload.sub === '') return null;
  return {
    sub: payload.sub,
    roles: toStringList(payload[config.OIDC_CLAIM_ROLES]),
    branchIds: toStringList(payload[config.OIDC_CLAIM_BRANCHES]),
  };
}

function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'unauthorized' });
}

export const authPlugin = fp<AuthPluginOptions>(
  async (app, opts) => {
    const { config } = opts;
    const getKey =
      opts.keyGetter ??
      remoteKeyGetter(config, opts.discoveryCooldownMs ?? DEFAULT_DISCOVERY_COOLDOWN_MS, app.log);

    app.decorateRequest('user');
    app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const header = request.headers.authorization;
      const match = typeof header === 'string' ? /^Bearer (\S+)$/i.exec(header) : null;
      if (!match?.[1]) {
        await unauthorized(reply);
        return;
      }

      try {
        const { payload } = await jwtVerify(match[1], getKey, {
          issuer: config.OIDC_ISSUER,
          audience: config.OIDC_AUDIENCE,
          algorithms: config.OIDC_ALGORITHMS,
          clockTolerance: config.OIDC_CLOCK_TOLERANCE_SECONDS,
          requiredClaims: ['exp', 'sub'],
        });
        const user = extractClaims(payload, config);
        if (!user) {
          await unauthorized(reply);
          return;
        }
        request.user = user;
      } catch (err) {
        // Só código/nome do erro vai para o log; nunca o token, nem a mensagem do jose na resposta.
        const code = err instanceof errors.JOSEError ? err.code : 'ERR_UNEXPECTED';
        if (isTokenError(err)) {
          request.log.info({ code }, 'Token rejeitado');
          await unauthorized(reply);
          return;
        }
        request.log.error(
          { code, errName: err instanceof Error ? err.name : 'unknown' },
          'Validação de token indisponível',
        );
        await reply.code(503).send({ error: 'auth_unavailable' });
      }
    });
  },
  { name: 'auth' },
);
