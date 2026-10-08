import { and, asc, eq, sql } from 'drizzle-orm';
import {
  branches,
  economicGroups,
  municipalities,
  portfolioCustomerOverrides,
  portfolioEconomicGroups,
  portfolioRegions,
  portfolioRetailNetworks,
  portfolioSellers,
  portfolios,
  portfolioTypes,
  productSubgroups,
  retailNetworks,
  sellers,
  states,
} from '../../db/schema.js';
import { auditFields } from '../shared/audit.js';
import type { Conn } from '../shared/db.js';
import { notFound } from '../shared/errors.js';
import type { PortfolioResponse, RegionResponse } from './schemas.js';

/** Agregado completo da carteira (informações, filtros, vendedores e contagem dos ajustes da prévia). */
export function loadAggregate(conn: Conn, id: number): PortfolioResponse {
  const row = conn
    .select({
      p: portfolios,
      branch: { id: branches.id, code: branches.code, name: branches.name },
      type: { id: portfolioTypes.id, code: portfolioTypes.code, name: portfolioTypes.name },
    })
    .from(portfolios)
    .innerJoin(branches, eq(branches.id, portfolios.branchId))
    .innerJoin(portfolioTypes, eq(portfolioTypes.id, portfolios.portfolioTypeId))
    .where(eq(portfolios.id, id))
    .get();
  if (!row) throw notFound();

  const regions: RegionResponse[] = conn
    .select({
      level: portfolioRegions.level,
      stateCode: portfolioRegions.stateCode,
      uf: states.uf,
      municipalityCode: portfolioRegions.municipalityCode,
      municipalityName: municipalities.name,
      neighborhoodKey: portfolioRegions.neighborhoodKey,
      neighborhoodLabel: portfolioRegions.neighborhoodLabel,
    })
    .from(portfolioRegions)
    .innerJoin(states, eq(states.ibgeCode, portfolioRegions.stateCode))
    .leftJoin(municipalities, eq(municipalities.ibgeCode, portfolioRegions.municipalityCode))
    .where(eq(portfolioRegions.portfolioId, id))
    .orderBy(asc(portfolioRegions.id))
    .all()
    .map((r) => ({
      level: r.level,
      stateCode: r.stateCode,
      uf: r.uf,
      ...(r.municipalityCode === null ? {} : { municipalityCode: r.municipalityCode }),
      ...(r.municipalityName === null ? {} : { municipalityName: r.municipalityName }),
      ...(r.neighborhoodKey === null ? {} : { neighborhoodKey: r.neighborhoodKey }),
      ...(r.neighborhoodLabel === null ? {} : { neighborhoodLabel: r.neighborhoodLabel }),
    }));

  const networks = conn
    .select({ id: retailNetworks.id, code: retailNetworks.code, name: retailNetworks.name })
    .from(portfolioRetailNetworks)
    .innerJoin(retailNetworks, eq(retailNetworks.id, portfolioRetailNetworks.retailNetworkId))
    .where(eq(portfolioRetailNetworks.portfolioId, id))
    .orderBy(asc(retailNetworks.code))
    .all();
  const groups = conn
    .select({ id: economicGroups.id, code: economicGroups.code, name: economicGroups.name })
    .from(portfolioEconomicGroups)
    .innerJoin(economicGroups, eq(economicGroups.id, portfolioEconomicGroups.economicGroupId))
    .where(eq(portfolioEconomicGroups.portfolioId, id))
    .orderBy(asc(economicGroups.code))
    .all();
  const pairs = conn
    .select({
      seller: { id: sellers.id, code: sellers.code, name: sellers.name },
      productSubgroup: {
        id: productSubgroups.id,
        code: productSubgroups.code,
        name: productSubgroups.name,
      },
    })
    .from(portfolioSellers)
    .innerJoin(sellers, eq(sellers.id, portfolioSellers.sellerId))
    .innerJoin(productSubgroups, eq(productSubgroups.id, portfolioSellers.productSubgroupId))
    .where(eq(portfolioSellers.portfolioId, id))
    .orderBy(asc(sellers.code), asc(productSubgroups.code))
    .all();

  const overrides = conn
    .select({
      include: sql<number>`coalesce(sum(${portfolioCustomerOverrides.kind} = 'include'), 0)`,
      exclude: sql<number>`coalesce(sum(${portfolioCustomerOverrides.kind} = 'exclude'), 0)`,
    })
    .from(portfolioCustomerOverrides)
    .where(
      and(
        eq(portfolioCustomerOverrides.portfolioId, id),
        // Ajuste órfão (cliente sem vínculo, ativo ou não, com a filial atual) não conta: não tem
        // efeito nem aparece, e contá-lo revelaria algo oculto.
        sql`exists (select 1 from customer_branches cb
                     where cb.customer_id = ${portfolioCustomerOverrides.customerId}
                       and cb.branch_id = ${row.p.branchId})`,
      ),
    )
    .get() ?? { include: 0, exclude: 0 };

  return {
    id: row.p.id,
    name: row.p.name,
    description: row.p.description,
    branch: row.branch,
    type: row.type,
    responsibleSub: row.p.responsibleSub,
    status: row.p.status,
    filters: { regions, retailNetworks: networks, economicGroups: groups },
    sellers: pairs,
    overridesInclude: overrides.include,
    overridesExclude: overrides.exclude,
    ...auditFields(row.p),
  };
}
