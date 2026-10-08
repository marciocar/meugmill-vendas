import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import {
  branches,
  economicGroups,
  municipalities,
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
import {
  assertVersion,
  auditFields,
  requireVersion,
  writeActive,
  type AuditedTable,
} from '../shared/audit.js';
import { assertAllInScope, requireAdmin, resolveScopeIds, type Actor } from '../shared/authz.js';
import { isUniqueViolation, writeTx, type Conn, type Db, type ServiceOptions } from '../shared/db.js';
import { DomainError, notFound } from '../shared/errors.js';
import { assertBranchesActive } from '../shared/links.js';
import { searchKey } from '../shared/normalize.js';
import { decodeCursor, resolveLimit, toPage, type Page } from '../shared/pagination.js';
import { keyContains } from '../shared/sql.js';
import { cleanText, parseInput } from '../shared/validate.js';
import { requireAdminister, requireEdit } from './authz.js';
import {
  CreatePortfolioSchema,
  PortfolioListQuerySchema,
  ReplaceFiltersSchema,
  ReplaceSellersSchema,
  UpdatePortfolioSchema,
  type CreatePortfolioInput,
  type PortfolioListItem,
  type PortfolioListParams,
  type PortfolioResponse,
  type RegionResponse,
  type ReplaceFiltersInput,
  type ReplaceSellersInput,
  type UpdatePortfolioInput,
} from './schemas.js';
import {
  assertActiveGroups,
  assertActiveNetworks,
  assertActiveType,
  assertNoDuplicates,
  assertSellersLinkedToBranch,
  validateAssignments,
  validateRegions,
} from './validate.js';

type PortfolioRow = typeof portfolios.$inferSelect;

export interface PortfolioService {
  /** Itens resumidos, só das filiais do token. */
  list(actor: Actor, params?: PortfolioListParams): Page<PortfolioListItem>;
  /** Agregado completo (informações, filtros e vendedores). */
  get(actor: Actor, id: number): PortfolioResponse;
  /** Cria o rascunho (admin com a filial no token). */
  create(actor: Actor, input: CreatePortfolioInput): PortfolioResponse;
  update(
    actor: Actor,
    id: number,
    expectedVersion: number | undefined,
    patch: UpdatePortfolioInput,
  ): PortfolioResponse;
  /** Substitui regiões, redes e grupos de uma vez. */
  replaceFilters(
    actor: Actor,
    id: number,
    expectedVersion: number | undefined,
    input: ReplaceFiltersInput,
  ): PortfolioResponse;
  /** Substitui os pares (vendedor, subgrupo) de uma vez. */
  replaceSellers(
    actor: Actor,
    id: number,
    expectedVersion: number | undefined,
    input: ReplaceSellersInput,
  ): PortfolioResponse;
  /** Inativação global (só admin), idempotente. */
  deactivate(actor: Actor, id: number, expectedVersion: number | undefined): PortfolioResponse;
  reactivate(actor: Actor, id: number, expectedVersion: number | undefined): PortfolioResponse;
}

const NAME_TAKEN = 'Já existe carteira com este nome na filial';

/** Descrição: trim; vazio, ausente ou null viram null (preserva quebras de linha). */
function cleanDescription(value: string | null | undefined): string | null {
  const out = value?.trim() ?? '';
  return out === '' ? null : out;
}

function cleanSub(value: string): string {
  return cleanText(value, 'responsibleSub');
}

export function createPortfolioService(db: Db, opts: ServiceOptions = {}): PortfolioService {
  const now = opts.now ?? Date.now;

  /** Carteira visível ao ator (filial no token); fora do escopo é not_found. */
  function findScoped(conn: Conn, actor: Actor, id: number): PortfolioRow {
    const row = conn.select().from(portfolios).where(eq(portfolios.id, id)).get();
    if (!row || !resolveScopeIds(conn, actor).includes(row.branchId)) throw notFound();
    return row;
  }

  function nameTaken(conn: Conn, branchId: number, key: string, exceptId?: number): boolean {
    return (
      conn
        .select({ id: portfolios.id })
        .from(portfolios)
        .where(
          and(
            eq(portfolios.branchId, branchId),
            eq(portfolios.nameKey, key),
            exceptId === undefined ? undefined : ne(portfolios.id, exceptId),
          ),
        )
        .get() !== undefined
    );
  }

  function loadAggregate(conn: Conn, id: number): PortfolioResponse {
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
      ...auditFields(row.p),
    };
  }

  /** Incrementa a versão do agregado uma vez e registra a auditoria. */
  function bump(conn: Conn, row: PortfolioRow, actor: Actor, extra: Partial<PortfolioRow> = {}): void {
    conn
      .update(portfolios)
      .set({ ...extra, version: row.version + 1, updatedAt: now(), updatedBy: actor.sub })
      .where(eq(portfolios.id, row.id))
      .run();
  }

  /**
   * Passos comuns das escritas: carteira no escopo (404), permissão de edição (403),
   * versão obrigatória (428) e igual à atual (409). Devolve a linha e a versão.
   */
  function openForEdit(conn: Conn, actor: Actor, id: number, expected: number | undefined): PortfolioRow {
    const row = findScoped(conn, actor, id);
    requireEdit(actor, row);
    const version = requireVersion(expected);
    assertVersion(row.version, version);
    return row;
  }

  function transition(actor: Actor, id: number, expected: number | undefined, active: boolean) {
    return writeTx(db, (tx) => {
      const row = findScoped(tx, actor, id);
      requireAdminister(actor);
      const version = requireVersion(expected);
      if (row.active === active) return loadAggregate(tx, id); // idempotente
      assertVersion(row.version, version);
      writeActive(tx, portfolios as unknown as AuditedTable, id, active, actor.sub, now());
      return loadAggregate(tx, id);
    });
  }

  const countOf = (table: string, alias: string) =>
    sql<number>`(select count(*) from ${sql.raw(table)} ${sql.raw(alias)} where ${sql.raw(alias)}.portfolio_id = ${portfolios.id})`;

  return {
    list(actor, params = {}) {
      const p = parseInput(PortfolioListQuerySchema, params);
      const limit = resolveLimit(p.limit);
      const after = decodeCursor(p.cursor);
      const scopeIds = resolveScopeIds(db, actor);
      if (scopeIds.length === 0) return { items: [], nextCursor: null };
      if (p.branchId !== undefined && !scopeIds.includes(p.branchId)) return { items: [], nextCursor: null };
      const q = p.q?.trim();
      const rows = db
        .select({
          id: portfolios.id,
          name: portfolios.name,
          branch: { id: branches.id, code: branches.code, name: branches.name },
          type: { id: portfolioTypes.id, code: portfolioTypes.code, name: portfolioTypes.name },
          status: portfolios.status,
          active: portfolios.active,
          responsibleSub: portfolios.responsibleSub,
          regionsCount: countOf('portfolio_regions', 'r'),
          retailNetworksCount: countOf('portfolio_retail_networks', 'n'),
          economicGroupsCount: countOf('portfolio_economic_groups', 'g'),
          sellersCount: sql<number>`(select count(distinct s.seller_id) from portfolio_sellers s where s.portfolio_id = ${portfolios.id})`,
          version: portfolios.version,
        })
        .from(portfolios)
        .innerJoin(branches, eq(branches.id, portfolios.branchId))
        .innerJoin(portfolioTypes, eq(portfolioTypes.id, portfolios.portfolioTypeId))
        .where(
          and(
            p.branchId === undefined
              ? inArray(portfolios.branchId, scopeIds)
              : eq(portfolios.branchId, p.branchId),
            after === undefined ? undefined : gt(portfolios.id, after),
            p.status === undefined ? undefined : eq(portfolios.status, p.status),
            p.active === undefined ? undefined : eq(portfolios.active, p.active),
            p.responsibleSub === undefined ? undefined : eq(portfolios.responsibleSub, p.responsibleSub),
            q ? keyContains(portfolios.nameKey, q) : undefined,
          ),
        )
        .orderBy(asc(portfolios.id))
        .limit(limit + 1)
        .all();
      return toPage(rows, limit, (r) => r.id);
    },

    get(actor, id) {
      findScoped(db, actor, id);
      return loadAggregate(db, id);
    },

    create(actor, input) {
      requireAdmin(actor);
      const data = parseInput(CreatePortfolioSchema, input);
      const name = cleanText(data.name, 'name');
      const responsibleSub = cleanSub(data.responsibleSub);
      return writeTx(db, (tx) => {
        assertAllInScope([data.branchId], resolveScopeIds(tx, actor));
        assertBranchesActive(tx, [data.branchId]);
        assertActiveType(tx, data.portfolioTypeId);
        const key = searchKey(name);
        if (nameTaken(tx, data.branchId, key)) throw new DomainError('conflict', NAME_TAKEN);
        const at = now();
        try {
          const row = tx
            .insert(portfolios)
            .values({
              branchId: data.branchId,
              name,
              nameKey: key,
              description: cleanDescription(data.description),
              responsibleSub,
              portfolioTypeId: data.portfolioTypeId,
              createdAt: at,
              updatedAt: at,
              createdBy: actor.sub,
              updatedBy: actor.sub,
            })
            .returning({ id: portfolios.id })
            .get();
          return loadAggregate(tx, row.id);
        } catch (err) {
          if (isUniqueViolation(err)) throw new DomainError('conflict', NAME_TAKEN);
          throw err;
        }
      });
    },

    update(actor, id, expectedVersion, patch) {
      return writeTx(db, (tx) => {
        const row = openForEdit(tx, actor, id, expectedVersion);
        const data = parseInput(UpdatePortfolioSchema, patch);
        const branchId = data.branchId ?? row.branchId;
        const responsibleSub =
          data.responsibleSub === undefined ? row.responsibleSub : cleanSub(data.responsibleSub);
        const changesBranch = branchId !== row.branchId;
        // Só quem é admin transfere a carteira; reenviar o mesmo valor não conta como troca.
        if (changesBranch || responsibleSub !== row.responsibleSub) requireAdminister(actor);
        if (changesBranch) {
          assertAllInScope([branchId], resolveScopeIds(tx, actor));
          assertBranchesActive(tx, [branchId]);
          const sellerIds = tx
            .selectDistinct({ id: portfolioSellers.sellerId })
            .from(portfolioSellers)
            .where(eq(portfolioSellers.portfolioId, id))
            .all()
            .map((r) => r.id);
          assertSellersLinkedToBranch(tx, branchId, sellerIds);
        }
        const typeId = data.portfolioTypeId ?? row.portfolioTypeId;
        if (typeId !== row.portfolioTypeId) assertActiveType(tx, typeId);
        const name = data.name === undefined ? row.name : cleanText(data.name, 'name');
        const key = searchKey(name);
        if ((changesBranch || key !== row.nameKey) && nameTaken(tx, branchId, key, id)) {
          throw new DomainError('conflict', NAME_TAKEN);
        }
        try {
          bump(tx, row, actor, {
            name,
            nameKey: key,
            branchId,
            responsibleSub,
            portfolioTypeId: typeId,
            description:
              data.description === undefined ? row.description : cleanDescription(data.description),
          });
        } catch (err) {
          if (isUniqueViolation(err)) throw new DomainError('conflict', NAME_TAKEN);
          throw err;
        }
        return loadAggregate(tx, id);
      });
    },

    replaceFilters(actor, id, expectedVersion, input) {
      return writeTx(db, (tx) => {
        const row = openForEdit(tx, actor, id, expectedVersion);
        const data = parseInput(ReplaceFiltersSchema, input);
        const regions = validateRegions(tx, data.regions);
        assertNoDuplicates(data.retailNetworkIds, String, 'Rede de varejo duplicada');
        assertNoDuplicates(data.economicGroupIds, String, 'Grupo econômico duplicado');
        assertActiveNetworks(tx, data.retailNetworkIds);
        assertActiveGroups(tx, data.economicGroupIds);

        tx.delete(portfolioRegions).where(eq(portfolioRegions.portfolioId, id)).run();
        tx.delete(portfolioRetailNetworks).where(eq(portfolioRetailNetworks.portfolioId, id)).run();
        tx.delete(portfolioEconomicGroups).where(eq(portfolioEconomicGroups.portfolioId, id)).run();
        if (regions.length > 0) {
          tx.insert(portfolioRegions)
            .values(regions.map((r) => ({ portfolioId: id, ...r })))
            .run();
        }
        if (data.retailNetworkIds.length > 0) {
          tx.insert(portfolioRetailNetworks)
            .values(data.retailNetworkIds.map((retailNetworkId) => ({ portfolioId: id, retailNetworkId })))
            .run();
        }
        if (data.economicGroupIds.length > 0) {
          tx.insert(portfolioEconomicGroups)
            .values(data.economicGroupIds.map((economicGroupId) => ({ portfolioId: id, economicGroupId })))
            .run();
        }
        bump(tx, row, actor);
        return loadAggregate(tx, id);
      });
    },

    replaceSellers(actor, id, expectedVersion, input) {
      return writeTx(db, (tx) => {
        const row = openForEdit(tx, actor, id, expectedVersion);
        const data = parseInput(ReplaceSellersSchema, input);
        validateAssignments(tx, row.branchId, data.assignments);
        tx.delete(portfolioSellers).where(eq(portfolioSellers.portfolioId, id)).run();
        if (data.assignments.length > 0) {
          tx.insert(portfolioSellers)
            .values(data.assignments.map((a) => ({ portfolioId: id, ...a })))
            .run();
        }
        bump(tx, row, actor);
        return loadAggregate(tx, id);
      });
    },

    deactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, false),
    reactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, true),
  };
}
