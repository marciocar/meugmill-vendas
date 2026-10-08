import { and, asc, eq, gt, sql, type SQL } from 'drizzle-orm';
import { customers, economicGroups, retailNetworks } from '../../db/schema.js';
import { assertVersion, requireVersion, type AuditedTable } from '../shared/audit.js';
import { assertAllInScope, intersects, requireAdmin, resolveScopeIds, type Actor } from '../shared/authz.js';
import { isUniqueViolation, writeTx, type Conn, type Db, type ServiceOptions } from '../shared/db.js';
import { DomainError, forbidden, invalid, notFound } from '../shared/errors.js';
import { findMunicipality } from '../geo/repository.js';
import { endLinksWhere } from '../links/write.js';
import {
  applyGlobalActiveTransition,
  applyLinkActiveTransition,
  assertBranchesActive,
  coversAllBranches,
  customerLinks,
  effectiveState,
  planLinkChange,
  publicBranches,
  type LinkResult,
} from '../shared/links.js';
import { isValidCnpj, normalizeCnpj } from '../shared/cnpj.js';
import { neighborhoodKey, searchKey } from '../shared/normalize.js';
import {
  decodeCursor,
  ListQuerySchema,
  resolveLimit,
  toPage,
  type ListParams,
  type Page,
} from '../shared/pagination.js';
import type { CrudService, SharedActiveService } from '../shared/service.js';
import { canReadBroadly } from '../visibility/profiles.js';
import { visibleCustomersSql } from '../visibility/sql.js';
import { customerSearchClause } from './search.js';
import { cleanOptionalText, cleanText, parseInput } from '../shared/validate.js';
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  type CreateCustomerInput,
  type CustomerResponse,
  type UpdateCustomerInput,
} from './schemas.js';

type CustomerRow = typeof customers.$inferSelect;

export interface CustomerService
  extends
    CrudService<CustomerResponse, CreateCustomerInput, UpdateCustomerInput>,
    SharedActiveService<CustomerResponse> {
  /**
   * Liga um cliente já existente (por CNPJ) a uma filial do ator. Admin; filial no token;
   * idempotente (já ligado não incrementa a versão). Devolve SÓ `{ id, version }`: nenhum dado do
   * cliente sai por aqui (o ator passa a enxergá-lo pelo GET normal, agora dentro do escopo).
   */
  linkCustomerToBranchByCnpj(actor: Actor, cnpj: string, branchId: number): LinkResult;
}

const CUSTOMER_EXISTS = 'Já existe cliente com este CNPJ';

function requireValidCnpj(raw: string): string {
  const cnpj = normalizeCnpj(raw);
  if (!isValidCnpj(cnpj)) throw invalid('CNPJ inválido');
  return cnpj;
}

/** UF e município coerentes: o município manda; `stateCode` informado precisa bater com ele. */
function resolveGeo(conn: Conn, municipalityCode: number, stateCode: number | undefined) {
  const municipality = findMunicipality(conn, municipalityCode);
  if (!municipality) throw invalid('Município inexistente');
  if (stateCode !== undefined && stateCode !== municipality.stateCode) {
    throw invalid('UF incompatível com o município');
  }
  return { municipalityCode: municipality.ibgeCode, stateCode: municipality.stateCode };
}

function requireActiveReference(conn: Conn, kind: 'retailNetwork' | 'economicGroup', id: number): void {
  const row =
    kind === 'retailNetwork'
      ? conn.select().from(retailNetworks).where(eq(retailNetworks.id, id)).get()
      : conn.select().from(economicGroups).where(eq(economicGroups.id, id)).get();
  if (!row || !row.active) {
    throw invalid(
      kind === 'retailNetwork' ? 'Rede inexistente ou inativa' : 'Grupo econômico inexistente ou inativo',
    );
  }
}

/**
 * Clientes (CNPJ global, vínculo N:N com filiais). Visível ao ator se ligado a >= 1 filial do token.
 * Editar os dados exige o mesmo (ele precisa enxergar o cliente). A resposta traz só as filiais do
 * escopo do ator.
 */
export function createCustomerService(db: Db, opts: ServiceOptions = {}): CustomerService {
  const now = opts.now ?? Date.now;

  const toResponses = (conn: Conn, rows: CustomerRow[], scopeIds: number[]): CustomerResponse[] => {
    const links = customerLinks.scopedBranches(
      conn,
      rows.map((r) => r.id),
      scopeIds,
    );
    return rows.map((r) => {
      const scoped = links.get(r.id);
      return {
        id: r.id,
        cnpj: r.cnpj,
        legalName: r.legalName,
        tradeName: r.tradeName,
        stateCode: r.stateCode,
        municipalityCode: r.municipalityCode,
        neighborhood: r.neighborhood,
        neighborhoodKey: r.neighborhoodKey,
        retailNetworkId: r.retailNetworkId,
        economicGroupId: r.economicGroupId,
        branches: publicBranches(scoped),
        // `active`/`deactivatedAt` refletem o estado visto pelo ator (registro global + vínculos do escopo).
        ...effectiveState(r, scoped),
        version: r.version,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  };
  const respond = (conn: Conn, id: number, scopeIds: number[]): CustomerResponse =>
    toResponses(conn, [findRaw(conn, id)], scopeIds)[0] as CustomerResponse;

  /**
   * Restrição de leitura do E8: quem não lê amplo (admin, supervisão ou legacy) só enxerga os clientes
   * visíveis pelos seus perfis. Sem restrição, devolve `undefined`.
   */
  const restrictToVisible = (actor: Actor): SQL | undefined =>
    canReadBroadly(actor, opts, 'customers')
      ? undefined
      : sql`${customers.id} in (select customer_id from (${visibleCustomersSql(actor, false)}))`;

  const findRaw = (conn: Conn, id: number): CustomerRow =>
    conn.select().from(customers).where(eq(customers.id, id)).get() as CustomerRow;
  const findVisible = (conn: Conn, id: number, scopeIds: number[]): CustomerRow => {
    const row = conn.select().from(customers).where(eq(customers.id, id)).get();
    if (!row || !intersects(customerLinks.branchIdsOf(conn, id), scopeIds)) throw notFound();
    return row;
  };

  function transition(
    actor: Actor,
    id: number,
    expected: number | undefined,
    active: boolean,
    scope: 'link' | 'global',
  ) {
    requireAdmin(actor);
    const version = requireVersion(expected);
    return writeTx(db, (tx) => {
      const scopeIds = resolveScopeIds(tx, actor);
      const row = findVisible(tx, id, scopeIds);
      const at = now();
      // Semântica documentada em `applyLinkActiveTransition` / `applyGlobalActiveTransition`.
      (scope === 'link' ? applyLinkActiveTransition : applyGlobalActiveTransition)({
        conn: tx,
        repo: customerLinks,
        table: customers as unknown as AuditedTable,
        row,
        scopeIds,
        active,
        expectedVersion: version,
        sub: actor.sub,
        at,
      });
      // Cliente inativo não mantém vínculo de carteira (E7): encerra com eventos, na mesma transação.
      if (!active) {
        if (scope === 'global') endLinksWhere(tx, { customerId: id }, actor.sub, at);
        else {
          const inScope = new Set(scopeIds);
          const off = customerLinks
            .links(tx, id)
            .filter((l) => inScope.has(l.branchId) && !l.active)
            .map((l) => l.branchId);
          endLinksWhere(tx, { customerId: id, branchIds: off }, actor.sub, at);
        }
      }
      return respond(tx, id, scopeIds);
    });
  }

  /** `active` filtra pelo estado visto pelo ator: registro ativo E ao menos um vínculo do escopo ativo. */
  const activeFilter = (active: boolean | undefined, scopeIds: number[]) => {
    if (active === undefined) return undefined;
    const effective = customerLinks.effectiveActiveClause(customers.active, customers.id, scopeIds);
    return active ? effective : sql`not ${effective}`;
  };

  return {
    list(actor, params: ListParams = {}): Page<CustomerResponse> {
      const p = parseInput(ListQuerySchema, params);
      const limit = resolveLimit(p.limit);
      const after = decodeCursor(p.cursor);
      const scopeIds = resolveScopeIds(db, actor);
      if (scopeIds.length === 0) return { items: [], nextCursor: null };
      const rows = db
        .select()
        .from(customers)
        .where(
          and(
            customerLinks.visibleClause(customers.id, scopeIds),
            after === undefined ? undefined : gt(customers.id, after),
            activeFilter(p.active, scopeIds),
            customerSearchClause(p.q),
            restrictToVisible(actor),
          ),
        )
        .orderBy(asc(customers.id))
        .limit(limit + 1)
        .all();
      return toPage(toResponses(db, rows, scopeIds), limit, (r) => r.id);
    },

    get(actor, id) {
      const scopeIds = resolveScopeIds(db, actor);
      const row = findVisible(db, id, scopeIds);
      // Fora dos visíveis é como inexistente (sem distinguir).
      const restriction = restrictToVisible(actor);
      if (
        restriction &&
        !db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.id, id), restriction))
          .get()
      ) {
        throw notFound();
      }
      return toResponses(db, [row], scopeIds)[0] as CustomerResponse;
    },

    create(actor, input) {
      requireAdmin(actor);
      const data = parseInput(CreateCustomerSchema, input);
      const cnpj = requireValidCnpj(data.cnpj);
      const legalName = cleanText(data.legalName, 'legalName');
      const tradeName = cleanOptionalText(data.tradeName);
      const neighborhood = cleanText(data.neighborhood, 'neighborhood');
      return writeTx(db, (tx) => {
        const scopeIds = resolveScopeIds(tx, actor);
        assertAllInScope(data.branchIds, scopeIds);
        if (tx.select({ id: customers.id }).from(customers).where(eq(customers.cnpj, cnpj)).get()) {
          throw new DomainError('customer_exists', CUSTOMER_EXISTS);
        }
        const geo = resolveGeo(tx, data.municipalityCode, data.stateCode);
        if (data.retailNetworkId != null) requireActiveReference(tx, 'retailNetwork', data.retailNetworkId);
        if (data.economicGroupId != null) requireActiveReference(tx, 'economicGroup', data.economicGroupId);
        assertBranchesActive(tx, data.branchIds);
        const at = now();
        try {
          const row = tx
            .insert(customers)
            .values({
              cnpj,
              legalName,
              legalNameKey: searchKey(legalName),
              tradeName,
              tradeNameKey: tradeName === null ? null : searchKey(tradeName),
              ...geo,
              neighborhood,
              neighborhoodKey: neighborhoodKey(neighborhood),
              retailNetworkId: data.retailNetworkId ?? null,
              economicGroupId: data.economicGroupId ?? null,
              createdAt: at,
              updatedAt: at,
              createdBy: actor.sub,
              updatedBy: actor.sub,
            })
            .returning()
            .get();
          customerLinks.add(tx, row.id, data.branchIds, actor.sub, at);
          return toResponses(tx, [row], scopeIds)[0] as CustomerResponse;
        } catch (err) {
          if (isUniqueViolation(err)) throw new DomainError('customer_exists', CUSTOMER_EXISTS);
          throw err;
        }
      });
    },

    update(actor, id, expectedVersion, patch) {
      requireAdmin(actor);
      const version = requireVersion(expectedVersion);
      const data = parseInput(UpdateCustomerSchema, patch);
      return writeTx(db, (tx) => {
        const scopeIds = resolveScopeIds(tx, actor);
        const row = findVisible(tx, id, scopeIds);
        assertVersion(row.version, version);

        // Dados compartilhados (valem para todas as filiais) exigem cobertura total do registro.
        // Só conta como alteração o que muda de fato: reenviar o mesmo valor não exige nada.
        const legalName =
          data.legalName === undefined ? row.legalName : cleanText(data.legalName, 'legalName');
        const tradeName = data.tradeName === undefined ? row.tradeName : cleanOptionalText(data.tradeName);
        const neighborhood =
          data.neighborhood === undefined ? row.neighborhood : cleanText(data.neighborhood, 'neighborhood');
        const sharedChanged =
          legalName !== row.legalName ||
          tradeName !== row.tradeName ||
          neighborhood !== row.neighborhood ||
          (data.municipalityCode !== undefined && data.municipalityCode !== row.municipalityCode) ||
          (data.stateCode !== undefined && data.stateCode !== row.stateCode) ||
          (data.retailNetworkId !== undefined && data.retailNetworkId !== row.retailNetworkId) ||
          (data.economicGroupId !== undefined && data.economicGroupId !== row.economicGroupId);
        if (sharedChanged && !coversAllBranches(customerLinks.branchIdsOf(tx, id), scopeIds)) {
          throw forbidden('Alterar dados compartilhados exige todas as filiais do cadastro no token');
        }

        const geo =
          data.municipalityCode !== undefined || data.stateCode !== undefined
            ? resolveGeo(tx, data.municipalityCode ?? row.municipalityCode, data.stateCode)
            : { municipalityCode: row.municipalityCode, stateCode: row.stateCode };
        // Referência só é revalidada quando muda (cliente antigo com rede inativada continua editável).
        if (data.retailNetworkId != null && data.retailNetworkId !== row.retailNetworkId) {
          requireActiveReference(tx, 'retailNetwork', data.retailNetworkId);
        }
        if (data.economicGroupId != null && data.economicGroupId !== row.economicGroupId) {
          requireActiveReference(tx, 'economicGroup', data.economicGroupId);
        }
        const at = now();
        if (data.branchIds !== undefined) {
          const plan = planLinkChange(customerLinks, tx, id, data.branchIds, scopeIds);
          customerLinks.remove(tx, id, plan.toRemove);
          endLinksWhere(tx, { customerId: id, branchIds: plan.toRemove }, actor.sub, at);
          customerLinks.add(tx, id, plan.toAdd, actor.sub, at);
        }
        tx.update(customers)
          .set({
            legalName,
            legalNameKey: searchKey(legalName),
            tradeName,
            tradeNameKey: tradeName === null ? null : searchKey(tradeName),
            ...geo,
            neighborhood,
            neighborhoodKey: neighborhoodKey(neighborhood),
            retailNetworkId: data.retailNetworkId === undefined ? row.retailNetworkId : data.retailNetworkId,
            economicGroupId: data.economicGroupId === undefined ? row.economicGroupId : data.economicGroupId,
            version: row.version + 1,
            updatedAt: at,
            updatedBy: actor.sub,
          })
          .where(eq(customers.id, id))
          .run();
        return respond(tx, id, scopeIds);
      });
    },

    deactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, false, 'link'),
    reactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, true, 'link'),
    deactivateGlobal: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, false, 'global'),
    reactivateGlobal: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, true, 'global'),

    linkCustomerToBranchByCnpj(actor, rawCnpj, branchId) {
      requireAdmin(actor);
      const cnpj = requireValidCnpj(rawCnpj);
      return writeTx(db, (tx) => {
        const scopeIds = resolveScopeIds(tx, actor);
        assertAllInScope([branchId], scopeIds);
        const row = tx.select().from(customers).where(eq(customers.cnpj, cnpj)).get();
        if (!row) throw notFound();
        if (customerLinks.branchIdsOf(tx, row.id).includes(branchId)) {
          return { id: row.id, version: row.version };
        }
        assertBranchesActive(tx, [branchId]);
        const at = now();
        customerLinks.add(tx, row.id, [branchId], actor.sub, at);
        tx.update(customers)
          .set({ version: row.version + 1, updatedAt: at, updatedBy: actor.sub })
          .where(eq(customers.id, row.id))
          .run();
        return { id: row.id, version: row.version + 1 };
      });
    },
  };
}
