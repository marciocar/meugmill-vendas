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
  | 'OIDC_ALGORITHMS'
  | 'OIDC_CLAIM_ROLES'
  | 'OIDC_CLAIM_BRANCHES'
  | 'OIDC_CLOCK_TOLERANCE_SECONDS'
>;

export interface AuthPluginOptions {
  config: AuthConfig;
  /** Substitui a busca da JWKS (uso em testes). */
  keyGetter?: JWTVerifyGetKey;
}

const FETCH_TIMEOUT_MS = 5000;

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

// Descobre o jwks_uri (se não configurado) de forma lazy e guarda o key getter; falhas não são cacheadas.
function remoteKeyGetter(config: AuthConfig): JWTVerifyGetKey {
  let getter: JWTVerifyGetKey | undefined;
  let pending: Promise<JWTVerifyGetKey> | undefined;

  async function resolve(): Promise<JWTVerifyGetKey> {
    let uri = config.OIDC_JWKS_URI;
    if (uri === undefined) {
      const discovery = `${config.OIDC_ISSUER.replace(/\/+$/, '')}/.well-known/openid-configuration`;
      const res = await fetch(discovery, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Discovery OIDC respondeu ${res.status}`);
      const doc = (await res.json()) as { jwks_uri?: unknown };
      if (typeof doc.jwks_uri !== 'string') throw new Error('Discovery OIDC sem jwks_uri');
      uri = doc.jwks_uri;
    }
    return createRemoteJWKSet(new URL(uri), { timeoutDuration: FETCH_TIMEOUT_MS });
  }

  return async (protectedHeader, token) => {
    if (!getter) {
      pending ??= resolve().finally(() => {
        pending = undefined;
      });
      getter = await pending;
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
    const getKey = opts.keyGetter ?? remoteKeyGetter(config);

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
