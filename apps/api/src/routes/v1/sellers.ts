import type { FastifyInstance } from 'fastify';
import {
  CreateSellerSchema,
  SellerResponseSchema,
  UpdateSellerSchema,
} from '../../domain/sellers/schemas.js';
import { createSellerService, type SellerService } from '../../domain/sellers/service.js';
import { registerCrudRoutes } from './crud.js';

export function registerSellerRoutes(
  app: FastifyInstance,
  opts: { prefix: string; service: SellerService },
): void {
  registerCrudRoutes(app, {
    prefix: opts.prefix,
    service: opts.service,
    responseSchema: SellerResponseSchema,
    createSchema: CreateSellerSchema,
    updateSchema: UpdateSellerSchema,
    tag: 'sellers',
  });
}

/** Plugin: vendedores. */
export async function sellerRoutes(app: FastifyInstance): Promise<void> {
  registerSellerRoutes(app, { prefix: '/sellers', service: createSellerService(app.db) });
}
