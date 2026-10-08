import { and, asc, eq, gt, or } from 'drizzle-orm';
import { sellers } from '../../db/schema.js';
import {
  assertVersion,
  auditFields,
  requireVersion,
  writeActive,
  type AuditedTable,
} from '../shared/audit.js';
import { assertAllInScope, intersects, requireAdmin, resolveScopeIds, type Actor } from '../shared/authz.js';
import { isUniqueViolation, writeTx, type Conn, type Db, type ServiceOptions } from '../shared/db.js';
import { DomainError, notFound } from '../shared/errors.js';
import { assertBranchesActive, planLinkChange, sellerLinks } from '../shared/links.js';
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
import { cleanCode, cleanText, parseInput } from '../shared/validate.js';
import {
  CreateSellerSchema,
  UpdateSellerSchema,
  type CreateSellerInput,
  type SellerResponse,
  type UpdateSellerInput,
} from './schemas.js';

type SellerRow = typeof sellers.$inferSelect;

export type SellerService = CrudService<SellerResponse, CreateSellerInput, UpdateSellerInput>;

/**
 * Vendedores (só código e nome + filiais). Visível ao ator se ligado a >= 1 filial do token.
 * A resposta traz apenas as filiais do escopo do ator (ver decisão no relatório da Fase 2).
 */
export function createSellerService(db: Db, opts: ServiceOptions = {}): SellerService {
  const now = opts.now ?? Date.now;

  const toResponses = (conn: Conn, rows: SellerRow[], scopeIds: number[]): SellerResponse[] => {
    const links = sellerLinks.scopedBranches(
      conn,
      rows.map((r) => r.id),
      scopeIds,
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      branches: links.get(r.id) ?? [],
      ...auditFields(r),
    }));
  };

  /** Busca o vendedor garantindo que o ator o enxerga; fora do escopo é not_found. */
  const findRaw = (conn: Conn, id: number): SellerRow =>
    conn.select().from(sellers).where(eq(sellers.id, id)).get() as SellerRow;
  const findVisible = (conn: Conn, id: number, scopeIds: number[]): SellerRow => {
    const row = conn.select().from(sellers).where(eq(sellers.id, id)).get();
    if (!row || !intersects(sellerLinks.branchIdsOf(conn, id), scopeIds)) throw notFound();
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
        writeActive(tx, sellers as unknown as AuditedTable, id, active, actor.sub, now());
      }
      return toResponses(tx, [findRaw(tx, id)], scopeIds)[0] as SellerResponse;
    });
  }

  return {
    list(actor, params: ListParams = {}): Page<SellerResponse> {
      const p = parseInput(ListQuerySchema, params);
      const limit = resolveLimit(p.limit);
      const after = decodeCursor(p.cursor);
      const scopeIds = resolveScopeIds(db, actor);
      if (scopeIds.length === 0) return { items: [], nextCursor: null };
      const q = p.q?.trim();
      const rows = db
        .select()
        .from(sellers)
        .where(
          and(
            sellerLinks.visibleClause(sellers.id, scopeIds),
            after === undefined ? undefined : gt(sellers.id, after),
            p.active === undefined ? undefined : eq(sellers.active, p.active),
            q ? or(likeContains(sellers.code, q), likeContains(sellers.name, q)) : undefined,
          ),
        )
        .orderBy(asc(sellers.id))
        .limit(limit + 1)
        .all();
      return toPage(toResponses(db, rows, scopeIds), limit, (r) => r.id);
    },

    get(actor, id) {
      const scopeIds = resolveScopeIds(db, actor);
      const row = findVisible(db, id, scopeIds);
      return toResponses(db, [row], scopeIds)[0] as SellerResponse;
    },

    create(actor, input) {
      requireAdmin(actor);
      const data = parseInput(CreateSellerSchema, input);
      const code = cleanCode(data.code);
      const name = cleanText(data.name, 'name');
      return writeTx(db, (tx) => {
        const scopeIds = resolveScopeIds(tx, actor);
        assertAllInScope(data.branchIds, scopeIds);
        if (tx.select({ id: sellers.id }).from(sellers).where(eq(sellers.code, code)).get()) {
          throw new DomainError('conflict', 'Código já cadastrado');
        }
        assertBranchesActive(tx, data.branchIds);
        const at = now();
        try {
          const row = tx
            .insert(sellers)
            .values({ code, name, createdAt: at, updatedAt: at, createdBy: actor.sub, updatedBy: actor.sub })
            .returning()
            .get();
          sellerLinks.add(tx, row.id, data.branchIds);
          return toResponses(tx, [row], scopeIds)[0] as SellerResponse;
        } catch (err) {
          if (isUniqueViolation(err)) throw new DomainError('conflict', 'Código já cadastrado');
          throw err;
        }
      });
    },

    update(actor, id, expectedVersion, patch) {
      requireAdmin(actor);
      const version = requireVersion(expectedVersion);
      const data = parseInput(UpdateSellerSchema, patch);
      return writeTx(db, (tx) => {
        const scopeIds = resolveScopeIds(tx, actor);
        const row = findVisible(tx, id, scopeIds);
        assertVersion(row.version, version);
        if (data.branchIds !== undefined) {
          const plan = planLinkChange(sellerLinks, tx, id, data.branchIds, scopeIds);
          sellerLinks.remove(tx, id, plan.toRemove);
          sellerLinks.add(tx, id, plan.toAdd);
        }
        tx.update(sellers)
          .set({
            name: data.name === undefined ? row.name : cleanText(data.name, 'name'),
            version: row.version + 1,
            updatedAt: now(),
            updatedBy: actor.sub,
          })
          .where(eq(sellers.id, id))
          .run();
        return toResponses(tx, [findRaw(tx, id)], scopeIds)[0] as SellerResponse;
      });
    },

    deactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, false),
    reactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, true),
  };
}
