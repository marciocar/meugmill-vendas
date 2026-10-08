import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  CreateSellerSchema,
  SellerResponseSchema,
  UpdateSellerSchema,
} from '../../domain/sellers/schemas.js';
import { LinkResultSchema } from '../../domain/shared/links.js';
import { createSellerService, type SellerService } from '../../domain/sellers/service.js';
import { registerCrudRoutes } from './crud.js';
import { actorOf, ERROR_RESPONSES, sendDomainError, setEtag, withEtag } from './http.js';

const CodeParamsSchema = Type.Object({ code: Type.String({ minLength: 1, maxLength: 32 }) });
const LinkBodySchema = Type.Object(
  { branchId: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export function registerSellerRoutes(
  app: FastifyInstance,
  opts: { prefix: string; service: SellerService },
): void {
  const { prefix, service } = opts;
  registerCrudRoutes(app, {
    prefix,
    service,
    responseSchema: SellerResponseSchema,
    createSchema: CreateSellerSchema,
    updateSchema: UpdateSellerSchema,
    tag: 'sellers',
    sharedActive: service,
  });

  // Liga um vendedor já cadastrado (em outra filial) à filial do admin. Idempotente. Responde SÓ
  // { id, version } (+ ETag): nenhum dado do vendedor é exposto antes de ele entrar no escopo do ator.
  app.post(
    `${prefix}/by-code/:code/branches`,
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['sellers'],
        params: CodeParamsSchema,
        body: LinkBodySchema,
        response: { 200: withEtag(LinkResultSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        const { code } = request.params as { code: string };
        const { branchId } = request.body as { branchId: number };
        const result = service.linkSellerToBranchByCode(actorOf(request), code, branchId);
        setEtag(reply, result.version);
        return result;
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );
}

/** Plugin: vendedores. */
export async function sellerRoutes(app: FastifyInstance): Promise<void> {
  registerSellerRoutes(app, { prefix: '/sellers', service: createSellerService(app.db) });
}
