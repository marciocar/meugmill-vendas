import { Type } from '@sinclair/typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { toActor, type Actor } from '../../domain/shared/authz.js';
import { DomainError, invalid } from '../../domain/shared/errors.js';

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
  const body =
    err.code === 'validation_error' ? { error: err.code, message: err.message } : { error: err.code };
  return reply.code(err.status).send(body);
}

/** Ator do request autenticado (`app.authenticate` já respondeu 401/503 quando não há usuário). */
export function actorOf(request: FastifyRequest): Actor {
  if (!request.user) throw new Error('request.user ausente após authenticate');
  return toActor(request.user);
}

/** Schema de erro `{ error }` (o `message` só existe em validation_error). */
export const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

/** Respostas de erro comuns, para espalhar em `schema.response`. */
export const ERROR_RESPONSES = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
  428: ErrorResponseSchema,
} as const;

/** `:id` de rota: inteiro positivo. */
export const IdParamsSchema = Type.Object({ id: Type.Integer({ minimum: 1 }) });
