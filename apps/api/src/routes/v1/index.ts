import type { FastifyInstance } from 'fastify';
import { branchRoutes } from './branches.js';
import { catalogRoutes } from './catalog.js';
import { customerRoutes } from './customers.js';
import { geoRoutes } from './geo.js';
import { sellerRoutes } from './sellers.js';

/**
 * Agregador das rotas v1 de dados mestres: catálogos, filiais, geo, vendedores e clientes.
 * Registrar com `app.register(v1Routes, { prefix: '/v1' })`; requer `app.db` e `app.authenticate`.
 */
export async function v1Routes(app: FastifyInstance): Promise<void> {
  await app.register(catalogRoutes);
  await app.register(branchRoutes);
  await app.register(geoRoutes);
  await app.register(sellerRoutes);
  await app.register(customerRoutes);
}
