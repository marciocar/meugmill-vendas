import type { FastifyInstance } from 'fastify';
import { createPortfolioTypeService } from '../../domain/portfolio-types/service.js';
import { registerCatalogRoutes } from './catalog.js';

/** Plugin: tipos de carteira (catálogo `code + name`, pela fábrica do catálogo). */
export async function portfolioTypeRoutes(app: FastifyInstance): Promise<void> {
  registerCatalogRoutes(app, { prefix: '/portfolio-types', service: createPortfolioTypeService(app.db) });
}
