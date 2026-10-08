import type { FastifyInstance } from 'fastify';
import {
  CheckBodySchema,
  CheckResponseSchema,
  MyCustomersQuerySchema,
  VisibilitySummarySchema,
  VisibleCustomersPageSchema,
  type CheckInput,
  type MyCustomersParams,
} from '../../domain/visibility/schemas.js';
import { createVisibilityService, type VisibilityService } from '../../domain/visibility/service.js';
import { actorOf, ERROR_RESPONSES, sendDomainError, serviceOptions } from './http.js';

export function registerVisibilityRoutes(app: FastifyInstance, opts: { service: VisibilityService }): void {
  const { service } = opts;

  // Resumo do que o ator enxerga: perfis efetivos, vendedor ligado e contagens (nenhum dado de cliente).
  app.get(
    '/me/visibility',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['visibility'],
        response: { 200: VisibilitySummarySchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.summary(actorOf(request));
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  // Clientes visíveis ao ator, paginados por cursor, com o motivo (`via`) de cada um.
  app.get(
    '/me/customers',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['visibility'],
        querystring: MyCustomersQuerySchema,
        response: { 200: VisibleCustomersPageSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.listMyCustomers(actorOf(request), request.query as MyCustomersParams);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  // Filtro em lote para pedidos e títulos: devolve só os ids visíveis (inexistente e invisível não se distinguem).
  // É leitura (POST só pelo corpo grande): não exige perfil de escrita.
  app.post(
    '/visibility/check',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['visibility'],
        body: CheckBodySchema,
        response: { 200: CheckResponseSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return service.check(actorOf(request), (request.body as CheckInput).customerIds);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );
}

/** Plugin: visibilidade (E8). */
export async function visibilityRoutes(app: FastifyInstance): Promise<void> {
  registerVisibilityRoutes(app, { service: createVisibilityService(app.db, serviceOptions(app)) });
}
