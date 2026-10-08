import { and, asc, eq, gt, or } from 'drizzle-orm';
import { customers, economicGroups, retailNetworks } from '../../db/schema.js';
import {
  assertVersion,
  auditFields,
  requireVersion,
  writeActive,
  type AuditedTable,
} from '../shared/audit.js';
import { assertAllInScope, intersects, requireAdmin, resolveScopeIds, type Actor } from '../shared/authz.js';
import { isUniqueViolation, writeTx, type Conn, type Db, type ServiceOptions } from '../shared/db.js';
import { DomainError, invalid, notFound } from '../shared/errors.js';
import { findMunicipality } from '../geo/repository.js';
import { assertBranchesActive, customerLinks, planLinkChange } from '../shared/links.js';
import { isValidCnpj, normalizeCnpj } from '../shared/cnpj.js';
import { neighborhoodKey } from '../shared/normalize.js';
import {
  decodeCursor,
  ListQuerySchema,
  resolveLimit,
  toPage,
  type ListParams,
  type Page,
} from '../shared/pagination.js';
import type { CrudService } from '../shared/service.js';
import { likeContains } from '../shared/sql.js';
import { cleanOptionalText, cleanText, parseInput } from '../shared/validate.js';
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  type CreateCustomerInput,
  type CustomerResponse,
  type UpdateCustomerInput,
} from './schemas.js';

type CustomerRow = typeof customers.$inferSelect;

export interface CustomerService extends CrudService<
  CustomerResponse,
  CreateCustomerInput,
  UpdateCustomerInput
> {
  /**
   * Liga um cliente já existente (por CNPJ) a uma filial do ator. Admin; filial no token;
   * idempotente (já ligado devolve o registro sem incrementar a versão).
   */
  linkCustomerToBranchByCnpj(actor: Actor, cnpj: string, branchId: number): CustomerResponse;
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
    return rows.map((r) => ({
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
      branches: links.get(r.id) ?? [],
      ...auditFields(r),
    }));
  };
  const respond = (conn: Conn, id: number, scopeIds: number[]): CustomerResponse =>
    toResponses(conn, [findRaw(conn, id)], scopeIds)[0] as CustomerResponse;

  const findRaw = (conn: Conn, id: number): CustomerRow =>
    conn.select().from(customers).where(eq(customers.id, id)).get() as CustomerRow;
  const findVisible = (conn: Conn, id: number, scopeIds: number[]): CustomerRow => {
    const row = conn.select().from(customers).where(eq(customers.id, id)).get();
    if (!row || !intersects(customerLinks.branchIdsOf(conn, id), scopeIds)) throw notFound();
    return row;
  };

  function transition(actor: Actor, id: number, expected: number | undefined, active: boolean) {
    requireAdmin(actor);
    const version = requireVersion(expected);
    return writeTx(db, (tx) => {
      const scopeIds = resolveScopeIds(tx, actor);
      const row = findVisible(tx, id, scopeIds);
      if (row.active !== active) {
        assertVersion(row.version, version);
        writeActive(tx, customers as unknown as AuditedTable, id, active, actor.sub, now());
      }
      return respond(tx, id, scopeIds);
    });
  }

  return {
    list(actor, params: ListParams = {}): Page<CustomerResponse> {
      const p = parseInput(ListQuerySchema, params);
      const limit = resolveLimit(p.limit);
      const after = decodeCursor(p.cursor);
      const scopeIds = resolveScopeIds(db, actor);
      if (scopeIds.length === 0) return { items: [], nextCursor: null };
      const q = p.q?.trim();
      const digits = q ? normalizeCnpj(q) : '';
      const rows = db
        .select()
        .from(customers)
        .where(
          and(
            customerLinks.visibleClause(customers.id, scopeIds),
            after === undefined ? undefined : gt(customers.id, after),
            p.active === undefined ? undefined : eq(customers.active, p.active),
            q
              ? or(
                  likeContains(customers.legalName, q),
                  likeContains(customers.tradeName, q),
                  digits ? likeContains(customers.cnpj, digits) : undefined,
                )
              : undefined,
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
              tradeName,
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
          customerLinks.add(tx, row.id, data.branchIds);
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
        if (data.branchIds !== undefined) {
          const plan = planLinkChange(customerLinks, tx, id, data.branchIds, scopeIds);
          customerLinks.remove(tx, id, plan.toRemove);
          customerLinks.add(tx, id, plan.toAdd);
        }
        const neighborhood =
          data.neighborhood === undefined ? row.neighborhood : cleanText(data.neighborhood, 'neighborhood');
        tx.update(customers)
          .set({
            legalName: data.legalName === undefined ? row.legalName : cleanText(data.legalName, 'legalName'),
            tradeName: data.tradeName === undefined ? row.tradeName : cleanOptionalText(data.tradeName),
            ...geo,
            neighborhood,
            neighborhoodKey: neighborhoodKey(neighborhood),
            retailNetworkId: data.retailNetworkId === undefined ? row.retailNetworkId : data.retailNetworkId,
            economicGroupId: data.economicGroupId === undefined ? row.economicGroupId : data.economicGroupId,
            version: row.version + 1,
            updatedAt: now(),
            updatedBy: actor.sub,
          })
          .where(eq(customers.id, id))
          .run();
        return respond(tx, id, scopeIds);
      });
    },

    deactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, false),
    reactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, true),

    linkCustomerToBranchByCnpj(actor, rawCnpj, branchId) {
      requireAdmin(actor);
      const cnpj = requireValidCnpj(rawCnpj);
      return writeTx(db, (tx) => {
        const scopeIds = resolveScopeIds(tx, actor);
        assertAllInScope([branchId], scopeIds);
        const row = tx.select().from(customers).where(eq(customers.cnpj, cnpj)).get();
        if (!row) throw notFound();
        if (!customerLinks.branchIdsOf(tx, row.id).includes(branchId)) {
          assertBranchesActive(tx, [branchId]);
          customerLinks.add(tx, row.id, [branchId]);
          tx.update(customers)
            .set({ version: row.version + 1, updatedAt: now(), updatedBy: actor.sub })
            .where(eq(customers.id, row.id))
            .run();
        }
        return respond(tx, row.id, scopeIds);
      });
    },
  };
}
