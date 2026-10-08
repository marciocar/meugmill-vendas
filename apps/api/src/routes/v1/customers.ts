import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  CreateCustomerSchema,
  CustomerResponseSchema,
  UpdateCustomerSchema,
} from '../../domain/customers/schemas.js';
import { createCustomerService, type CustomerService } from '../../domain/customers/service.js';
import { registerCrudRoutes } from './crud.js';
import { actorOf, ERROR_RESPONSES, sendDomainError, setEtag } from './http.js';

/**
 * CNPJ no path: numérico ou alfanumérico, com ou sem máscara (a máscara chega codificada, `%2F`).
 * A validação de verdade (formato e DV) é do domínio.
 */
const CnpjParamsSchema = Type.Object({
  cnpj: Type.String({ minLength: 14, maxLength: 18, pattern: '^[0-9A-Za-z./-]+$' }),
});
const LinkBodySchema = Type.Object(
  { branchId: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export function registerCustomerRoutes(
  app: FastifyInstance,
  opts: { prefix: string; service: CustomerService },
): void {
  const { prefix, service } = opts;
  registerCrudRoutes(app, {
    prefix,
    service,
    responseSchema: CustomerResponseSchema,
    createSchema: CreateCustomerSchema,
    updateSchema: UpdateCustomerSchema,
    tag: 'customers',
  });

  // Liga um cliente já cadastrado (em outra filial) à filial do admin. Idempotente.
  app.post(
    `${prefix}/by-cnpj/:cnpj/branches`,
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['customers'],
        params: CnpjParamsSchema,
        body: LinkBodySchema,
        response: { 200: CustomerResponseSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        const { cnpj } = request.params as { cnpj: string };
        const { branchId } = request.body as { branchId: number };
        const row = service.linkCustomerToBranchByCnpj(actorOf(request), cnpj, branchId);
        setEtag(reply, row.version);
        return row;
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );
}

/** Plugin: clientes. */
export async function customerRoutes(app: FastifyInstance): Promise<void> {
  registerCustomerRoutes(app, { prefix: '/customers', service: createCustomerService(app.db) });
}
