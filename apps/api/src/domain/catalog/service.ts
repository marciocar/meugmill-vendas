import { and, asc, eq, gt, or } from 'drizzle-orm';
import { economicGroups, productSubgroups, retailNetworks } from '../../db/schema.js';
import {
  assertVersion,
  auditFields,
  requireVersion,
  writeActive,
  type AuditedTable,
} from '../shared/audit.js';
import { requireAdmin, type Actor } from '../shared/authz.js';
import { isUniqueViolation, writeTx, type Conn, type Db, type ServiceOptions } from '../shared/db.js';
import { DomainError, orNotFound } from '../shared/errors.js';
import {
  decodeCursor,
  ListQuerySchema,
  resolveLimit,
  toPage,
  type ListParams,
  type Page,
} from '../shared/pagination.js';
import type { CrudService } from '../shared/service.js';
import { searchKey } from '../shared/normalize.js';
import { keyContains, likeContains } from '../shared/sql.js';
import { cleanCode, cleanText, parseInput } from '../shared/validate.js';
import {
  CreateCatalogSchema,
  UpdateCatalogSchema,
  type CatalogResponse,
  type CreateCatalogInput,
  type UpdateCatalogInput,
} from './schemas.js';

/** As três tabelas têm o mesmo formato (code + name); `productSubgroups` serve de molde de tipo. */
type CatalogTable = typeof productSubgroups;
type CatalogRow = CatalogTable['$inferSelect'];

export type CatalogService = CrudService<CatalogResponse, CreateCatalogInput, UpdateCatalogInput>;

function toResponse(row: CatalogRow): CatalogResponse {
  return { id: row.id, code: row.code, name: row.name, ...auditFields(row) };
}

/**
 * Serviço genérico para cadastros globais `code + name` (subgrupos, redes, grupos econômicos).
 * [INFERIDO] Não pertencem a filial: leitura para qualquer ator, escrita para qualquer admin.
 */
export function createCatalogService(db: Db, table: CatalogTable, opts: ServiceOptions = {}): CatalogService {
  const now = opts.now ?? Date.now;
  const audited = table as unknown as AuditedTable;

  const find = (conn: Conn, id: number): CatalogRow | undefined =>
    conn.select().from(table).where(eq(table.id, id)).get();
  const mustFind = (conn: Conn, id: number): CatalogRow => orNotFound(find(conn, id));

  function transition(actor: Actor, id: number, expected: number | undefined, active: boolean) {
    requireAdmin(actor);
    const version = requireVersion(expected);
    return writeTx(db, (tx) => {
      const row = mustFind(tx, id);
      if (row.active === active) return toResponse(row); // idempotente
      assertVersion(row.version, version);
      writeActive(tx, audited, id, active, actor.sub, now());
      return toResponse(mustFind(tx, id));
    });
  }

  return {
    list(_actor: Actor, params: ListParams = {}): Page<CatalogResponse> {
      const p = parseInput(ListQuerySchema, params);
      const limit = resolveLimit(p.limit);
      const after = decodeCursor(p.cursor);
      const q = p.q?.trim();
      const rows = db
        .select()
        .from(table)
        .where(
          and(
            after === undefined ? undefined : gt(table.id, after),
            p.active === undefined ? undefined : eq(table.active, p.active),
            q ? or(likeContains(table.code, q), keyContains(table.nameKey, q)) : undefined,
          ),
        )
        .orderBy(asc(table.id))
        .limit(limit + 1)
        .all();
      return toPage(rows.map(toResponse), limit, (r) => r.id);
    },

    get(_actor, id) {
      return toResponse(mustFind(db, id));
    },

    create(actor, input) {
      requireAdmin(actor);
      const data = parseInput(CreateCatalogSchema, input);
      const code = cleanCode(data.code);
      const name = cleanText(data.name, 'name');
      return writeTx(db, (tx) => {
        if (tx.select({ id: table.id }).from(table).where(eq(table.code, code)).get()) {
          throw new DomainError('conflict', 'Código já cadastrado');
        }
        const at = now();
        try {
          const row = tx
            .insert(table)
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
          return toResponse(row);
        } catch (err) {
          if (isUniqueViolation(err)) throw new DomainError('conflict', 'Código já cadastrado');
          throw err;
        }
      });
    },

    update(actor, id, expectedVersion, patch) {
      requireAdmin(actor);
      const version = requireVersion(expectedVersion);
      const data = parseInput(UpdateCatalogSchema, patch);
      const name = cleanText(data.name, 'name');
      return writeTx(db, (tx) => {
        const row = mustFind(tx, id);
        assertVersion(row.version, version);
        tx.update(table)
          .set({
            name,
            nameKey: searchKey(name),
            version: row.version + 1,
            updatedAt: now(),
            updatedBy: actor.sub,
          })
          .where(eq(table.id, id))
          .run();
        return toResponse(mustFind(tx, id));
      });
    },

    deactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, false),
    reactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, true),
  };
}

export const createProductSubgroupService = (db: Db, opts?: ServiceOptions): CatalogService =>
  createCatalogService(db, productSubgroups, opts);
// Mesma forma de tabela; o cast só aplaca o tipo literal do nome da tabela.
export const createRetailNetworkService = (db: Db, opts?: ServiceOptions): CatalogService =>
  createCatalogService(db, retailNetworks as unknown as CatalogTable, opts);
export const createEconomicGroupService = (db: Db, opts?: ServiceOptions): CatalogService =>
  createCatalogService(db, economicGroups as unknown as CatalogTable, opts);
