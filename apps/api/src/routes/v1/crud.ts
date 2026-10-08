import { Type, type TSchema } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ListQuerySchema, PageSchema, type ListParams } from '../../domain/shared/pagination.js';
import type { Actor } from '../../domain/shared/authz.js';
import type { CrudService, SharedActiveService } from '../../domain/shared/service.js';
import {
  actorOf,
  ERROR_RESPONSES,
  IdParamsSchema,
  parseIfMatch,
  sendDomainError,
  setEtag,
  withEtag,
} from './http.js';

export interface CrudRoutesOptions<R extends { version: number }, C, U> {
  /** Caminho do recurso, ex.: `/branches`. */
  prefix: string;
  service: CrudService<R, C, U>;
  responseSchema: TSchema;
  createSchema: TSchema;
  updateSchema: TSchema;
  tag: string;
  /** Cadastros compartilhados: habilita `deactivate-global`/`reactivate-global`. */
  sharedActive?: SharedActiveService<R>;
}

/** Rotas CRUD comuns (lista, detalhe, criar, alterar, inativar, reativar) de um `CrudService`. */
export function registerCrudRoutes<R extends { version: number }, C, U>(
  app: FastifyInstance,
  o: CrudRoutesOptions<R, C, U>,
): void {
  const { prefix, service } = o;
  // onRequest: a autenticação roda antes da validação de params/corpo (anônimo é sempre 401).
  const onRequest = app.authenticate;
  const tags = [o.tag];
  const ifMatch = Type.Object({ 'if-match': Type.Optional(Type.String({ maxLength: 40 })) });

  app.get(
    prefix,
    {
      onRequest,
      schema: {
        tags,
        querystring: ListQuerySchema,
        response: { 200: PageSchema(o.responseSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.list(actorOf(request), request.query as ListParams);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get(
    `${prefix}/:id`,
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        response: { 200: withEtag(o.responseSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: number };
        const row = service.get(actorOf(request), id);
        setEtag(reply, row.version);
        return row;
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.post(
    prefix,
    {
      onRequest,
      schema: {
        tags,
        body: o.createSchema,
        response: { 201: withEtag(o.responseSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        const row = service.create(actorOf(request), request.body as C);
        setEtag(reply, row.version);
        return await reply.code(201).send(row);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.patch(
    `${prefix}/:id`,
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        headers: ifMatch,
        body: o.updateSchema,
        response: { 200: withEtag(o.responseSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: number };
        const row = service.update(
          actorOf(request),
          id,
          parseIfMatch(request.headers['if-match']),
          request.body as U,
        );
        setEtag(reply, row.version);
        return row;
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  const transitions: { path: string; run: (actor: Actor, id: number, v: number | undefined) => R }[] = [
    { path: 'deactivate', run: (a, id, v) => service.deactivate(a, id, v) },
    { path: 'reactivate', run: (a, id, v) => service.reactivate(a, id, v) },
  ];
  if (o.sharedActive) {
    const shared = o.sharedActive;
    transitions.push(
      { path: 'deactivate-global', run: (a, id, v) => shared.deactivateGlobal(a, id, v) },
      { path: 'reactivate-global', run: (a, id, v) => shared.reactivateGlobal(a, id, v) },
    );
  }
  for (const { path, run } of transitions) {
    app.post(
      `${prefix}/:id/${path}`,
      {
        onRequest,
        schema: {
          tags,
          params: IdParamsSchema,
          headers: ifMatch,
          response: { 200: withEtag(o.responseSchema), ...ERROR_RESPONSES },
        },
      },
      async (request, reply) => {
        try {
          const { id } = request.params as { id: number };
          const row = run(actorOf(request), id, parseIfMatch(request.headers['if-match']));
          setEtag(reply, row.version);
          return row;
        } catch (err) {
          return sendDomainError(reply, err);
        }
      },
    );
  }
}
