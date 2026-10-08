import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { sellers } from '../../db/schema.js';
import { endLinksWhere } from '../links/write.js';
import { assertVersion, requireVersion, type AuditedTable } from '../shared/audit.js';
import { assertAllInScope, intersects, requireAdmin, resolveScopeIds, type Actor } from '../shared/authz.js';
import { isUniqueViolation, writeTx, type Conn, type Db, type ServiceOptions } from '../shared/db.js';
import { DomainError, forbidden, notFound } from '../shared/errors.js';
import {
  applyGlobalActiveTransition,
  applyLinkActiveTransition,
  assertBranchesActive,
  coversAllBranches,
  effectiveState,
  planLinkChange,
  publicBranches,
  sellerLinks,
  type LinkResult,
} from '../shared/links.js';
import { searchKey } from '../shared/normalize.js';
import {
  decodeCursor,
  ListQuerySchema,
  resolveLimit,
  toPage,
  type ListParams,
  type Page,
} from '../shared/pagination.js';
import type { CrudService, SharedActiveService } from '../shared/service.js';
import { keyContains, likeContains } from '../shared/sql.js';
import { cleanCode, cleanText, parseInput } from '../shared/validate.js';
import {
  CreateSellerSchema,
  UpdateSellerSchema,
  type CreateSellerInput,
  type SellerResponse,
  type UpdateSellerInput,
} from './schemas.js';

type SellerRow = typeof sellers.$inferSelect;

export interface SellerService
  extends
    CrudService<SellerResponse, CreateSellerInput, UpdateSellerInput>,
    SharedActiveService<SellerResponse> {
  /**
   * Liga um vendedor já existente (por código) a uma filial do ator. Admin; filial no token;
   * idempotente. Devolve SÓ `{ id, version }`: nenhum dado do vendedor sai por aqui.
   */
  linkSellerToBranchByCode(actor: Actor, code: string, branchId: number): LinkResult;
}

const SELLER_EXISTS = 'Já existe vendedor com este código';

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
    return rows.map((r) => {
      const scoped = links.get(r.id);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        branches: publicBranches(scoped),
        // `active`/`deactivatedAt` refletem o estado visto pelo ator (registro global + vínculos do escopo).
        ...effectiveState(r, scoped),
        version: r.version,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  };

  /** Busca o vendedor garantindo que o ator o enxerga; fora do escopo é not_found. */
  const findRaw = (conn: Conn, id: number): SellerRow =>
    conn.select().from(sellers).where(eq(sellers.id, id)).get() as SellerRow;
  const findVisible = (conn: Conn, id: number, scopeIds: number[]): SellerRow => {
    const row = conn.select().from(sellers).where(eq(sellers.id, id)).get();
    if (!row || !intersects(sellerLinks.branchIdsOf(conn, id), scopeIds)) throw notFound();
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
        repo: sellerLinks,
        table: sellers as unknown as AuditedTable,
        row,
        scopeIds,
        active,
        expectedVersion: version,
        sub: actor.sub,
        at,
      });
      // Vendedor inativo não mantém clientes presos (E7): encerra os vínculos de carteira, com eventos.
      if (!active) {
        if (scope === 'global') endLinksWhere(tx, { sellerId: id }, actor.sub, at);
        else {
          const inScope = new Set(scopeIds);
          const off = sellerLinks
            .links(tx, id)
            .filter((l) => inScope.has(l.branchId) && !l.active)
            .map((l) => l.branchId);
          endLinksWhere(tx, { sellerId: id, branchIds: off }, actor.sub, at);
        }
      }
      return toResponses(tx, [findRaw(tx, id)], scopeIds)[0] as SellerResponse;
    });
  }

  /** `active` filtra pelo estado visto pelo ator: registro ativo E ao menos um vínculo do escopo ativo. */
  const activeFilter = (active: boolean | undefined, scopeIds: number[]) => {
    if (active === undefined) return undefined;
    const effective = sellerLinks.effectiveActiveClause(sellers.active, sellers.id, scopeIds);
    return active ? effective : sql`not ${effective}`;
  };

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
            activeFilter(p.active, scopeIds),
            q ? or(likeContains(sellers.code, q), keyContains(sellers.nameKey, q)) : undefined,
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
          throw new DomainError('seller_exists', SELLER_EXISTS);
        }
        assertBranchesActive(tx, data.branchIds);
        const at = now();
        try {
          const row = tx
            .insert(sellers)
            .values({
              code,
              name,
              nameKey: searchKey(name),
              createdAt: at,
              updatedAt: at,
              createdBy: actor.sub,
              updatedBy: actor.sub,
            })
            .returning()
            .get();
          sellerLinks.add(tx, row.id, data.branchIds, actor.sub, at);
          return toResponses(tx, [row], scopeIds)[0] as SellerResponse;
        } catch (err) {
          if (isUniqueViolation(err)) throw new DomainError('seller_exists', SELLER_EXISTS);
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
        // O nome vale para todas as filiais: só quem cobre todas as filiais do vendedor o altera.
        const name = data.name === undefined ? row.name : cleanText(data.name, 'name');
        if (name !== row.name && !coversAllBranches(sellerLinks.branchIdsOf(tx, id), scopeIds)) {
          throw forbidden('Alterar dados compartilhados exige todas as filiais do cadastro no token');
        }
        const at = now();
        if (data.branchIds !== undefined) {
          const plan = planLinkChange(sellerLinks, tx, id, data.branchIds, scopeIds);
          sellerLinks.remove(tx, id, plan.toRemove);
          endLinksWhere(tx, { sellerId: id, branchIds: plan.toRemove }, actor.sub, at);
          sellerLinks.add(tx, id, plan.toAdd, actor.sub, at);
        }
        tx.update(sellers)
          .set({
            name,
            nameKey: searchKey(name),
            version: row.version + 1,
            updatedAt: at,
            updatedBy: actor.sub,
          })
          .where(eq(sellers.id, id))
          .run();
        return toResponses(tx, [findRaw(tx, id)], scopeIds)[0] as SellerResponse;
      });
    },

    deactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, false, 'link'),
    reactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, true, 'link'),
    deactivateGlobal: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, false, 'global'),
    reactivateGlobal: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, true, 'global'),

    linkSellerToBranchByCode(actor, rawCode, branchId) {
      requireAdmin(actor);
      const code = cleanCode(rawCode);
      return writeTx(db, (tx) => {
        const scopeIds = resolveScopeIds(tx, actor);
        assertAllInScope([branchId], scopeIds);
        const row = tx.select().from(sellers).where(eq(sellers.code, code)).get();
        if (!row) throw notFound();
        if (sellerLinks.branchIdsOf(tx, row.id).includes(branchId)) {
          return { id: row.id, version: row.version };
        }
        assertBranchesActive(tx, [branchId]);
        const at = now();
        sellerLinks.add(tx, row.id, [branchId], actor.sub, at);
        tx.update(sellers)
          .set({ version: row.version + 1, updatedAt: at, updatedBy: actor.sub })
          .where(eq(sellers.id, row.id))
          .run();
        return { id: row.id, version: row.version + 1 };
      });
    },
  };
}
