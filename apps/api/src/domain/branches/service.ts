import { withRoleGuard } from '../visibility/profiles.js';
import { and, asc, eq, gt, inArray, or } from 'drizzle-orm';
import { branches } from '../../db/schema.js';
import { assertVersion, auditFields, requireVersion, writeActive } from '../shared/audit.js';
import { requireAdmin, type Actor } from '../shared/authz.js';
import { isUniqueViolation, writeTx, type Conn, type Db, type ServiceOptions } from '../shared/db.js';
import { DomainError, forbidden, invalid, notFound } from '../shared/errors.js';
import { findMunicipality } from '../geo/repository.js';
import { endLinksWhere } from '../links/write.js';
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
  CreateBranchSchema,
  UpdateBranchSchema,
  type BranchResponse,
  type CreateBranchInput,
  type UpdateBranchInput,
} from './schemas.js';

type BranchRow = typeof branches.$inferSelect;

export type BranchService = CrudService<BranchResponse, CreateBranchInput, UpdateBranchInput>;

function toResponse(row: BranchRow): BranchResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    municipalityCode: row.municipalityCode,
    ...auditFields(row),
  };
}

/**
 * Filiais. Visibilidade: a filial só existe para o ator se o `code` dela estiver no token
 * (fora disso, not_found). Escrita: admin; filial nova exige o código no token do admin.
 */
export function createBranchService(db: Db, opts: ServiceOptions = {}): BranchService {
  const now = opts.now ?? Date.now;

  const visible = (actor: Actor, row: BranchRow | undefined): BranchRow => {
    if (!row || !actor.branchCodes.includes(row.code)) throw notFound();
    return row;
  };
  const find = (conn: Conn, id: number): BranchRow | undefined =>
    conn.select().from(branches).where(eq(branches.id, id)).get();
  const requireMunicipality = (conn: Conn, code: number): void => {
    if (!findMunicipality(conn, code)) throw invalid('Município inexistente');
  };

  function transition(actor: Actor, id: number, expected: number | undefined, active: boolean) {
    requireAdmin(actor);
    const version = requireVersion(expected);
    return writeTx(db, (tx) => {
      const row = visible(actor, find(tx, id));
      if (row.active === active) return toResponse(row);
      assertVersion(row.version, version);
      const at = now();
      writeActive(tx, branches, id, active, actor.sub, at);
      // Filial inativa não mantém vínculos de carteira (E7): encerra todos, com eventos.
      if (!active) endLinksWhere(tx, { branchIds: [id] }, actor.sub, at);
      return toResponse(visible(actor, find(tx, id)));
    });
  }

  return withRoleGuard(
    {
      list(actor, params: ListParams = {}): Page<BranchResponse> {
        const p = parseInput(ListQuerySchema, params);
        const limit = resolveLimit(p.limit);
        const after = decodeCursor(p.cursor);
        if (actor.branchCodes.length === 0) return { items: [], nextCursor: null };
        const q = p.q?.trim();
        const rows = db
          .select()
          .from(branches)
          .where(
            and(
              inArray(branches.code, actor.branchCodes),
              after === undefined ? undefined : gt(branches.id, after),
              p.active === undefined ? undefined : eq(branches.active, p.active),
              q ? or(likeContains(branches.code, q), keyContains(branches.nameKey, q)) : undefined,
            ),
          )
          .orderBy(asc(branches.id))
          .limit(limit + 1)
          .all();
        return toPage(rows.map(toResponse), limit, (r) => r.id);
      },

      get(actor, id) {
        return toResponse(visible(actor, find(db, id)));
      },

      create(actor, input) {
        requireAdmin(actor);
        const data = parseInput(CreateBranchSchema, input);
        const code = cleanCode(data.code);
        const name = cleanText(data.name, 'name');
        if (!actor.branchCodes.includes(code)) throw forbidden('Filial fora do escopo do usuário');
        return writeTx(db, (tx) => {
          if (tx.select({ id: branches.id }).from(branches).where(eq(branches.code, code)).get()) {
            throw new DomainError('conflict', 'Código já cadastrado');
          }
          requireMunicipality(tx, data.municipalityCode);
          const at = now();
          try {
            return toResponse(
              tx
                .insert(branches)
                .values({
                  code,
                  name,
                  nameKey: searchKey(name),
                  municipalityCode: data.municipalityCode,
                  createdAt: at,
                  updatedAt: at,
                  createdBy: actor.sub,
                  updatedBy: actor.sub,
                })
                .returning()
                .get(),
            );
          } catch (err) {
            if (isUniqueViolation(err)) throw new DomainError('conflict', 'Código já cadastrado');
            throw err;
          }
        });
      },

      update(actor, id, expectedVersion, patch) {
        requireAdmin(actor);
        const version = requireVersion(expectedVersion);
        const data = parseInput(UpdateBranchSchema, patch);
        return writeTx(db, (tx) => {
          const row = visible(actor, find(tx, id));
          assertVersion(row.version, version);
          if (data.municipalityCode !== undefined) requireMunicipality(tx, data.municipalityCode);
          const name = data.name === undefined ? row.name : cleanText(data.name, 'name');
          tx.update(branches)
            .set({
              name,
              nameKey: searchKey(name),
              municipalityCode: data.municipalityCode ?? row.municipalityCode,
              version: row.version + 1,
              updatedAt: now(),
              updatedBy: actor.sub,
            })
            .where(eq(branches.id, id))
            .run();
          return toResponse(visible(actor, find(tx, id)));
        });
      },

      deactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, false),
      reactivate: (actor, id, expectedVersion) => transition(actor, id, expectedVersion, true),
    },
    opts,
  );
}
