import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  OverridesResponseSchema,
  PreviewQuerySchema,
  PreviewResponseSchema,
  ReplaceOverridesSchema,
  type PreviewQuery,
  type ReplaceOverridesInput,
} from '../../domain/eligibility/schemas.js';
import { createEligibilityService, type EligibilityService } from '../../domain/eligibility/service.js';
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

const tags = ['portfolios'];
const ifMatch = Type.Object({ 'if-match': Type.Optional(Type.String({ maxLength: 40 })) });

/** Rotas da prévia de elegibilidade e dos ajustes manuais da carteira (etapa "Clientes" do wizard). */
export function registerEligibilityRoutes(
  app: FastifyInstance,
  opts: { prefix: string; service: EligibilityService },
): void {
  const { prefix, service } = opts;
  // onRequest: a autenticação roda antes da validação de params/corpo (anônimo é sempre 401).
  const onRequest = app.authenticate;
  const idOf = (request: { params: unknown }) => (request.params as { id: number }).id;

  app.get(
    `${prefix}/:id/preview`,
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        querystring: PreviewQuerySchema,
        response: { 200: PreviewResponseSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.preview(actorOf(request), idOf(request), request.query as PreviewQuery);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get(
    `${prefix}/:id/overrides`,
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        response: { 200: OverridesResponseSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.getOverrides(actorOf(request), idOf(request));
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.put(
    `${prefix}/:id/overrides`,
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        headers: ifMatch,
        body: ReplaceOverridesSchema,
        response: { 200: withEtag(PortfolioResponseSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        const row = service.replaceOverrides(
          actorOf(request),
          idOf(request),
          parseIfMatch(request.headers['if-match']),
          request.body as ReplaceOverridesInput,
        );
        setEtag(reply, row.version);
        return row;
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );
}

/** Plugin: prévia e ajustes da carteira. */
export async function eligibilityRoutes(app: FastifyInstance): Promise<void> {
  registerEligibilityRoutes(app, { prefix: '/portfolios', service: createEligibilityService(app.db) });
}
