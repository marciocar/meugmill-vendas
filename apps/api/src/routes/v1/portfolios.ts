import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CreatePortfolioSchema,
  PortfolioGetQuerySchema,
  PortfolioListQuerySchema,
  PortfolioListItemSchema,
  PortfolioResponseSchema,
  ReplaceFiltersSchema,
  ReplaceSellersSchema,
  UpdatePortfolioSchema,
  type CreatePortfolioInput,
  type PortfolioInclude,
  type PortfolioListParams,
  type PortfolioResponse,
  type ReplaceFiltersInput,
  type ReplaceSellersInput,
  type UpdatePortfolioInput,
} from '../../domain/portfolios/schemas.js';
import { createPortfolioService, type PortfolioService } from '../../domain/portfolios/service.js';
import { PageSchema } from '../../domain/shared/pagination.js';
import type { Actor } from '../../domain/shared/authz.js';
import {
  actorOf,
  ERROR_RESPONSES,
  IdParamsSchema,
  parseIfMatch,
  sendDomainError,
  setEtag,
  withEtag,
} from './http.js';

const tags = ['portfolios'];
const ifMatch = Type.Object({ 'if-match': Type.Optional(Type.String({ maxLength: 40 })) });

/** Rotas da carteira (agregado editado por seções, uma por etapa do wizard). */
export function registerPortfolioRoutes(
  app: FastifyInstance,
  opts: { prefix: string; service: PortfolioService },
): void {
  const { prefix, service } = opts;
  // onRequest: a autenticação roda antes da validação de params/corpo (anônimo é sempre 401).
  const onRequest = app.authenticate;
  const response = { 200: withEtag(PortfolioResponseSchema), ...ERROR_RESPONSES };

  /** Executa a operação e devolve o agregado com o ETag da versão atual. */
  async function respond(
    reply: FastifyReply,
    run: () => PortfolioResponse,
    status = 200,
  ): Promise<FastifyReply | PortfolioResponse> {
    try {
      const row = run();
      setEtag(reply, row.version);
      return status === 200 ? row : await reply.code(status).send(row);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  }
  const idOf = (request: FastifyRequest) => (request.params as { id: number }).id;
  const versionOf = (request: FastifyRequest) => parseIfMatch(request.headers['if-match']);

  app.get(
    prefix,
    {
      onRequest,
      schema: {
        tags,
        querystring: PortfolioListQuerySchema,
        response: { 200: PageSchema(PortfolioListItemSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.list(actorOf(request), request.query as PortfolioListParams);
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
        body: CreatePortfolioSchema,
        response: { 201: withEtag(PortfolioResponseSchema), ...ERROR_RESPONSES },
      },
    },
    (request, reply) =>
      respond(reply, () => service.create(actorOf(request), request.body as CreatePortfolioInput), 201),
  );

  app.get(
    `${prefix}/:id`,
    { onRequest, schema: { tags, params: IdParamsSchema, querystring: PortfolioGetQuerySchema, response } },
    (request, reply) =>
      respond(reply, () =>
        service.get(
          actorOf(request),
          idOf(request),
          (request.query as { include?: PortfolioInclude }).include,
        ),
      ),
  );

  app.patch(
    `${prefix}/:id`,
    {
      onRequest,
      schema: { tags, params: IdParamsSchema, headers: ifMatch, body: UpdatePortfolioSchema, response },
    },
    (request, reply) =>
      respond(reply, () =>
        service.update(
          actorOf(request),
          idOf(request),
          versionOf(request),
          request.body as UpdatePortfolioInput,
        ),
      ),
  );

  app.put(
    `${prefix}/:id/filters`,
    {
      onRequest,
      schema: { tags, params: IdParamsSchema, headers: ifMatch, body: ReplaceFiltersSchema, response },
    },
    (request, reply) =>
      respond(reply, () =>
        service.replaceFilters(
          actorOf(request),
          idOf(request),
          versionOf(request),
          request.body as ReplaceFiltersInput,
        ),
      ),
  );

  app.put(
    `${prefix}/:id/sellers`,
    {
      onRequest,
      schema: { tags, params: IdParamsSchema, headers: ifMatch, body: ReplaceSellersSchema, response },
    },
    (request, reply) =>
      respond(reply, () =>
        service.replaceSellers(
          actorOf(request),
          idOf(request),
          versionOf(request),
          request.body as ReplaceSellersInput,
        ),
      ),
  );

  const transitions: {
    path: string;
    run: (a: Actor, id: number, v: number | undefined) => PortfolioResponse;
  }[] = [
    { path: 'deactivate', run: (a, id, v) => service.deactivate(a, id, v) },
    { path: 'reactivate', run: (a, id, v) => service.reactivate(a, id, v) },
  ];
  for (const { path, run } of transitions) {
    app.post(
      `${prefix}/:id/${path}`,
      { onRequest, schema: { tags, params: IdParamsSchema, headers: ifMatch, response } },
      (request, reply) => respond(reply, () => run(actorOf(request), idOf(request), versionOf(request))),
    );
  }
}

/** Plugin: carteiras. */
export async function portfolioRoutes(app: FastifyInstance): Promise<void> {
  registerPortfolioRoutes(app, { prefix: '/portfolios', service: createPortfolioService(app.db) });
}
