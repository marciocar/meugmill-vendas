import { Type, type TSchema } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { toActor, type Actor } from '../../domain/shared/authz.js';
import type { ServiceOptions } from '../../domain/shared/db.js';
import { DOMAIN_ERROR_STATUS, DomainError, invalid } from '../../domain/shared/errors.js';

/**
 * Lê o `If-Match` e devolve a versão esperada. Aceita `"3"`, `3` e `W/"3"`.
 * Ausente -> `undefined` (o service responde 428 `precondition_required`).
 * Presente mas malformado (`*`, vazio, texto, versão 0, cabeçalho repetido) -> `validation_error` (400),
 * sem repetir o valor recebido.
 */
export function parseIfMatch(header: string | string[] | undefined): number | undefined {
  if (header === undefined) return undefined;
  const match =
    typeof header === 'string' ? /^(?:W\/)?(?:"(\d{1,15})"|(\d{1,15}))$/.exec(header.trim()) : null;
  const digits = match?.[1] ?? match?.[2];
  const version = digits ? Number(digits) : 0;
  if (version < 1) throw invalid('Cabeçalho If-Match inválido');
  return version;
}

/** Define `ETag: "<version>"` na resposta. */
export function setEtag(reply: FastifyReply, version: number): void {
  void reply.header('ETag', `"${version}"`);
}

/**
 * Traduz `DomainError` em `{ error: code }` com o status de `DOMAIN_ERROR_STATUS`.
 * Só `validation_error` leva `message` (texto fixo do domínio, sem o valor enviado). Outros erros
 * são relançados e caem no error handler global (500 genérico).
 */
export function sendDomainError(reply: FastifyReply, err: unknown): FastifyReply {
  if (!(err instanceof DomainError)) throw err;
  // `detail` (contagens e ids de carteiras, nunca dados de cliente) sai só nos erros que o definem.
  const body =
    err.code === 'validation_error'
      ? { error: err.code, message: err.message }
      : err.detail
        ? { error: err.code, detail: err.detail }
        : { error: err.code };
  return reply.code(err.status).send(body);
}

/** Ator do request autenticado (`app.authenticate` já respondeu 401/503 quando não há usuário). */
export function actorOf(request: FastifyRequest): Actor {
  if (!request.user) throw new Error('request.user ausente após authenticate');
  return toActor(request.user);
}

/** Schema de erro `{ error }` (o `message` só existe em validation_error). */
const DetailSchema = Type.Record(Type.String(), Type.Union([Type.Integer(), Type.Array(Type.Integer())]), {
  description: 'Contagens e ids de carteiras que explicam o conflito (nunca dados de clientes).',
});

export const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  detail: Type.Optional(DetailSchema),
});

/** Códigos de domínio com status 409 (documentados na resposta 409 do OpenAPI). */
const CONFLICT_CODES = Object.entries(DOMAIN_ERROR_STATUS)
  .filter(([, status]) => status === 409)
  .map(([code]) => code);

const ConflictResponseSchema = Type.Object(
  { error: Type.String(), message: Type.Optional(Type.String()), detail: Type.Optional(DetailSchema) },
  { description: `Conflito: ${CONFLICT_CODES.join(', ')}.` },
);

/**
 * Anexa ao schema de resposta o header `ETag` (só documentação OpenAPI: o Fastify não valida
 * headers de resposta e o serializador ignora a chave).
 */
export function withEtag<T extends TSchema>(schema: T): T {
  return {
    ...schema,
    headers: {
      ETag: { type: 'string', description: 'Versão atual do registro entre aspas (`"3"`); use em If-Match.' },
    },
  };
}

/** Respostas de erro comuns, para espalhar em `schema.response`. */
export const ERROR_RESPONSES = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ConflictResponseSchema,
  428: ErrorResponseSchema,
} as const;

/** `:id` de rota: inteiro positivo. */
export const IdParamsSchema = Type.Object({ id: Type.Integer({ minimum: 1 }) });

/**
 * Opções dos serviços de domínio: liga o aviso de acesso `legacy` (E8) ao logger da app.
 * Loga só o nome do recurso, nunca `sub`, papéis, filiais nem dado de negócio.
 */
export function serviceOptions(app: FastifyInstance): ServiceOptions {
  return {
    visibilityLegacy: app.visibilityLegacy,
    onRoleMismatch: () => {
      app.log.warn(
        'role_case_mismatch: papel parecido com um perfil conhecido, mas com caixa ou espaços diferentes',
      );
    },
    onLegacyAccess: (resource) => {
      app.log.warn({ resource }, 'legacy_access: token sem perfil de visibilidade lê toda a filial');
    },
  };
}
