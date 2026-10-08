import type { FastifyInstance } from 'fastify';
import {
  CatalogResponseSchema,
  CreateCatalogSchema,
  UpdateCatalogSchema,
} from '../../domain/catalog/schemas.js';
import {
  createEconomicGroupService,
  createProductSubgroupService,
  createRetailNetworkService,
  type CatalogService,
} from '../../domain/catalog/service.js';
import { registerCrudRoutes } from './crud.js';

export interface CatalogRoutesOptions {
  prefix: string;
  service: CatalogService;
}

/** Rotas de um cadastro `code + name` (lista, detalhe, criar, alterar, inativar, reativar). */
export function registerCatalogRoutes(app: FastifyInstance, opts: CatalogRoutesOptions): void {
  registerCrudRoutes(app, {
    prefix: opts.prefix,
    service: opts.service,
    responseSchema: CatalogResponseSchema,
    createSchema: CreateCatalogSchema,
    updateSchema: UpdateCatalogSchema,
    tag: opts.prefix.replace(/^\//, ''),
  });
}

/** Plugin: subgrupos de produto, redes de varejo e grupos econômicos. */
export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  registerCatalogRoutes(app, { prefix: '/product-subgroups', service: createProductSubgroupService(app.db) });
  registerCatalogRoutes(app, { prefix: '/retail-networks', service: createRetailNetworkService(app.db) });
  registerCatalogRoutes(app, { prefix: '/economic-groups', service: createEconomicGroupService(app.db) });
}
