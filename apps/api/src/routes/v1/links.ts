import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  LinkEventsQuerySchema,
  LinkHistoryQuerySchema,
  LinkListQuerySchema,
  type LinkEventsParams,
  type LinkHistoryParams,
  type LinkListParams,
} from '../../domain/links/schemas.js';
import { createLinkService, type LinkService } from '../../domain/links/service.js';
import { PortfolioResponseSchema } from '../../domain/portfolios/schemas.js';
import {
  actorOf,
  ERROR_RESPONSES,
  IdParamsSchema,
  parseIfMatch,
  sendDomainError,
  setEtag,
  withEtag,
} from './http.js';

const tags = ['links'];
const ifMatch = Type.Object({ 'if-match': Type.Optional(Type.String({ maxLength: 40 })) });

const Ref = Type.Object({ id: Type.Integer(), code: Type.String(), name: Type.String() });

const LinkItemSchema = Type.Object({
  id: Type.Integer(),
  customer: Type.Object({ id: Type.Integer(), cnpj: Type.String(), legalName: Type.String() }),
  productSubgroup: Ref,
  seller: Ref,
  active: Type.Boolean(),
  validFrom: Type.Integer(),
  validTo: Type.Union([Type.Integer(), Type.Null()], { description: 'null enquanto o vínculo está ativo.' }),
});

const LinkPageSchema = Type.Object({
  items: Type.Array(LinkItemSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
  total: Type.Integer({ description: 'Vínculos ativos que casam os filtros (não só a página).' }),
});

const LinkHistoryPageSchema = Type.Object({
  items: Type.Array(LinkItemSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});

const CodeRef = Type.Object({ id: Type.Integer(), code: Type.String() });

const LinkEventPageSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      id: Type.Integer(),
      kind: Type.Union([Type.Literal('created'), Type.Literal('ended')]),
      linkId: Type.Integer(),
      portfolioId: Type.Integer(),
      branch: CodeRef,
      customer: Type.Object({ id: Type.Integer(), cnpj: Type.String() }),
      productSubgroup: CodeRef,
      seller: CodeRef,
      occurredAt: Type.Integer(),
    }),
  ),
  nextAfter: Type.Union([Type.Integer(), Type.Null()], {
    description: 'Id do último evento entregue; use como `after` na próxima leitura.',
  }),
  hasMore: Type.Boolean(),
});

const FinalizeResponseSchema = Type.Object(
  {
    portfolio: PortfolioResponseSchema,
    created: Type.Integer({ description: 'Vínculos criados (célula nova ou vendedor trocado).' }),
    ended: Type.Integer({ description: 'Vínculos encerrados (saiu da grade ou vendedor trocado).' }),
    kept: Type.Integer({ description: 'Vínculos ativos preservados (mesmo vendedor).' }),
    takenOver: Type.Integer({
      description: 'Vínculos encerrados em outras carteiras da filial, quando esta vence a disputa.',
    }),
  },
  {
    description:
      'Resultado da finalização. O ETag é o da versão da carteira; sem mudança nos vínculos e com a carteira ' +
      'já ativa, nada é gravado e a versão não muda. Erros 409 de regra levam `detail`: ' +
      '`portfolio_incomplete {unassigned, stale}`, `portfolio_has_conflicts {blocked}` e ' +
      '`link_conflict {portfolioIds}` (caso fail-closed raro).',
  },
);

/** Rotas dos vínculos da carteira (E7): finalizar, ler, histórico e outbox de eventos. */
export function registerLinkRoutes(app: FastifyInstance, opts: { service: LinkService }): void {
  const { service } = opts;
  // onRequest: a autenticação roda antes da validação de params/corpo (anônimo é sempre 401).
  const onRequest = app.authenticate;
  const idOf = (request: { params: unknown }) => (request.params as { id: number }).id;

  app.post(
    '/portfolios/:id/finalize',
    {
      onRequest,
      // Corpo opcional e ignorado: sem corpo equivale a `{}`.
      preValidation: async (request) => {
        request.body ??= {};
      },
      schema: {
        tags,
        params: IdParamsSchema,
        headers: ifMatch,
        body: Type.Object({}, { additionalProperties: false }),
        response: { 200: withEtag(FinalizeResponseSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        const result = service.finalize(
          actorOf(request),
          idOf(request),
          parseIfMatch(request.headers['if-match']),
        );
        setEtag(reply, result.aggregate.version);
        return {
          portfolio: result.aggregate,
          created: result.created,
          ended: result.ended,
          kept: result.kept,
          takenOver: result.takenOver,
        };
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get(
    '/portfolios/:id/links',
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        querystring: LinkListQuerySchema,
        response: { 200: LinkPageSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.listLinks(actorOf(request), idOf(request), request.query as LinkListParams);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get(
    '/portfolios/:id/links/history',
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        querystring: LinkHistoryQuerySchema,
        response: { 200: LinkHistoryPageSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.listLinkHistory(actorOf(request), idOf(request), request.query as LinkHistoryParams);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get(
    '/link-events',
    {
      onRequest,
      schema: {
        tags,
        querystring: LinkEventsQuerySchema,
        response: { 200: LinkEventPageSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.listLinkEvents(actorOf(request), request.query as LinkEventsParams);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );
}

/** Plugin: vínculos da carteira e outbox de eventos. */
export async function linkRoutes(app: FastifyInstance): Promise<void> {
  registerLinkRoutes(app, { service: createLinkService(app.db) });
}
