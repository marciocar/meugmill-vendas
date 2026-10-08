import { portfolioTypes, type productSubgroups } from '../../db/schema.js';
import { createCatalogService, type CatalogService } from '../catalog/service.js';
import type { Db, ServiceOptions } from '../shared/db.js';

/** Tipo de carteira: catálogo `code + name` global, igual aos três catálogos do E2. */
export const createPortfolioTypeService = (db: Db, opts?: ServiceOptions): CatalogService =>
  // Mesma forma de tabela; o cast só aplaca o tipo literal do nome da tabela.
  createCatalogService(db, portfolioTypes as unknown as typeof productSubgroups, opts);
