import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  ASSIGNMENT_STATUSES,
  AssignmentListQuerySchema,
  DistributeSchema,
  ReplaceAssignmentsSchema,
  type AssignmentListParams,
  type DistributeInput,
  type ReplaceAssignmentsInput,
} from '../../domain/distribution/schemas.js';
import { createDistributionService, type DistributionService } from '../../domain/distribution/service.js';
import { PortfolioResponseSchema } from '../../domain/portfolios/schemas.js';
import {
  actorOf,
  ERROR_RESPONSES,
  IdParamsSchema,
  parseIfMatch,
  sendDomainError,
  setEtag,
  withEtag,
  serviceOptions,
} from './http.js';

const tags = ['portfolios'];
const ifMatch = Type.Object({ 'if-match': Type.Optional(Type.String({ maxLength: 40 })) });

const Ref = (extra = {}) =>
  Type.Object({ id: Type.Integer(), code: Type.String(), name: Type.String(), ...extra });

const AssignmentPageSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      customer: Type.Object({ id: Type.Integer(), cnpj: Type.String(), legalName: Type.String() }),
      productSubgroup: Ref(),
      seller: Type.Union([Ref(), Type.Null()]),
      status: Type.Union(ASSIGNMENT_STATUSES.map((s) => Type.Literal(s))),
    }),
  ),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
  total: Type.Integer(),
});

const AssignmentSummarySchema = Type.Object({
  subgroups: Type.Array(
    Type.Object({
      productSubgroup: Ref(),
      sellers: Type.Array(Type.Object({ seller: Ref(), count: Type.Integer() })),
      unassigned: Type.Integer(),
      stale: Type.Integer(),
    }),
  ),
  totals: Type.Object({
    members: Type.Integer(),
    cells: Type.Integer(),
    assigned: Type.Integer(),
    unassigned: Type.Integer(),
    stale: Type.Integer(),
  }),
});

const DistributeResponseSchema = Type.Object(
  {
    portfolio: PortfolioResponseSchema,
    distributed: Type.Record(Type.String(), Type.Integer(), {
      description: 'Atribuições gravadas por id de subgrupo (só os distribuídos).',
    }),
    skippedSubgroupIds: Type.Array(Type.Integer(), {
      description: 'Subgrupos ignorados por não terem vendedor utilizável.',
    }),
    finalCounts: Type.Record(
      Type.String(),
      Type.Array(Type.Object({ sellerId: Type.Integer(), count: Type.Integer() })),
      {
        description:
          'Contagem FINAL de células válidas por vendedor, por id de subgrupo (preservadas + gravadas agora). ' +
          'O equilíbrio vale só sobre as células preenchidas nesta execução: com atribuições anteriores, a ' +
          'diferença entre vendedores pode passar de 1.',
      },
    ),
  },
  {
    description:
      'Resultado da distribuição. O ETag é o da versão da carteira (`portfolio`); quando não há nada a ' +
      'preencher, nada é gravado e a versão não muda.',
  },
);

/** Rotas da distribuição dos clientes da carteira entre os vendedores de cada subgrupo (E6). */
export function registerDistributionRoutes(
  app: FastifyInstance,
  opts: { prefix: string; service: DistributionService },
): void {
  const { prefix, service } = opts;
  // onRequest: a autenticação roda antes da validação de params/corpo (anônimo é sempre 401).
  const onRequest = app.authenticate;
  const idOf = (request: { params: unknown }) => (request.params as { id: number }).id;

  app.get(
    `${prefix}/:id/assignments`,
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        querystring: AssignmentListQuerySchema,
        response: { 200: AssignmentPageSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.listAssignments(
          actorOf(request),
          idOf(request),
          request.query as AssignmentListParams,
        );
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get(
    `${prefix}/:id/assignments/summary`,
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        response: { 200: AssignmentSummarySchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.summary(actorOf(request), idOf(request));
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.put(
    `${prefix}/:id/assignments`,
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        headers: ifMatch,
        body: ReplaceAssignmentsSchema,
        response: { 200: withEtag(PortfolioResponseSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        const row = service.replaceAssignments(
          actorOf(request),
          idOf(request),
          parseIfMatch(request.headers['if-match']),
          request.body as ReplaceAssignmentsInput,
        );
        setEtag(reply, row.version);
        return row;
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.post(
    `${prefix}/:id/distribute`,
    {
      onRequest,
      // Corpo opcional: sem corpo equivale a `{}` (distribuir todos os subgrupos).
      preValidation: async (request) => {
        request.body ??= {};
      },
      schema: {
        tags,
        params: IdParamsSchema,
        headers: ifMatch,
        body: DistributeSchema,
        response: { 200: withEtag(DistributeResponseSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        const result = service.distribute(
          actorOf(request),
          idOf(request),
          parseIfMatch(request.headers['if-match']),
          (request.body ?? {}) as DistributeInput,
        );
        setEtag(reply, result.aggregate.version);
        return {
          portfolio: result.aggregate,
          distributed: result.distributed,
          skippedSubgroupIds: result.skippedSubgroupIds,
          finalCounts: result.finalCounts,
        };
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );
}

/** Plugin: distribuição das atribuições da carteira. */
export async function distributionRoutes(app: FastifyInstance): Promise<void> {
  registerDistributionRoutes(app, {
    prefix: '/portfolios',
    service: createDistributionService(app.db, serviceOptions(app)),
  });
}
