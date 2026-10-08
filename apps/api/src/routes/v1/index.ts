import type { FastifyInstance } from 'fastify';
import { branchRoutes } from './branches.js';
import { catalogRoutes } from './catalog.js';
import { csvRoutes } from './csv.js';
import { customerRoutes } from './customers.js';
import { distributionRoutes } from './distribution.js';
import { eligibilityRoutes } from './eligibility.js';
import { geoRoutes } from './geo.js';
import { linkRoutes } from './links.js';
import { portfolioRoutes } from './portfolios.js';
import { portfolioTypeRoutes } from './portfolio-types.js';
import { sellerRoutes } from './sellers.js';
import { visibilityRoutes } from './visibility.js';

/**
 * Agregador das rotas v1 de dados mestres: catálogos, filiais, geo, vendedores, clientes e carteiras.
 * Registrar com `app.register(v1Routes, { prefix: '/v1' })`; requer `app.db` e `app.authenticate`.
 */
export async function v1Routes(app: FastifyInstance): Promise<void> {
  await app.register(catalogRoutes);
  await app.register(branchRoutes);
  await app.register(geoRoutes);
  await app.register(sellerRoutes);
  await app.register(customerRoutes);
  await app.register(portfolioTypeRoutes);
  await app.register(portfolioRoutes);
  await app.register(eligibilityRoutes);
  await app.register(distributionRoutes);
  await app.register(linkRoutes);
  await app.register(visibilityRoutes);
  await app.register(csvRoutes);
}
