import { economicGroups, productSubgroups, retailNetworks } from '../../../db/schema.js';
import type { LayoutId } from '../layouts.js';
import { linkImporter } from './links.js';
import { branchImporter, catalogImporter, customerImporter, sellerImporter } from './master.js';
import { portfolioImporter } from './portfolios.js';
import type { Importer } from './types.js';

export const IMPORTERS: Record<LayoutId, Importer> = {
  branches: branchImporter,
  'product-subgroups': catalogImporter(productSubgroups, (ctx) => ctx.services.productSubgroups),
  'retail-networks': catalogImporter(retailNetworks, (ctx) => ctx.services.retailNetworks),
  'economic-groups': catalogImporter(economicGroups, (ctx) => ctx.services.economicGroups),
  sellers: sellerImporter,
  customers: customerImporter,
  portfolios: portfolioImporter,
  links: linkImporter,
};
