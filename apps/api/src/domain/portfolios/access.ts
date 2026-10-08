import { and, eq, sql, type SQL } from 'drizzle-orm';
import { portfolios } from '../../db/schema.js';
import { assertVersion, requireVersion } from '../shared/audit.js';
import { resolveScopeIds, type Actor } from '../shared/authz.js';
import type { Conn, ServiceOptions } from '../shared/db.js';
import { DomainError, notFound } from '../shared/errors.js';
import { canReadBroadly } from '../visibility/profiles.js';
import { portfolioReadableSql } from '../visibility/sql.js';
import { requireEdit } from './authz.js';

export type PortfolioRow = typeof portfolios.$inferSelect;

export const INACTIVE = 'Carteira inativa: reative antes de editar';

/** Carteira visível ao ator (filial no token); fora do escopo é not_found. */
export function findScoped(conn: Conn, actor: Actor, id: number): PortfolioRow {
  const row = conn.select().from(portfolios).where(eq(portfolios.id, id)).get();
  if (!row || !resolveScopeIds(conn, actor).includes(row.branchId)) throw notFound();
  return row;
}

/**
 * Leitura da carteira em si (E3, E8): quem não lê amplo (admin, supervisão ou legacy) só enxerga as em que
 * é responsável ou em que o seu vendedor atua. Sem restrição, devolve `undefined`.
 */
export function visiblePortfoliosClause(actor: Actor, opts?: ServiceOptions): SQL | undefined {
  return canReadBroadly(actor, opts, 'portfolios') ? undefined : portfolioReadableSql(actor);
}

/** Carteira visível ao ator (escopo de filial + `visiblePortfoliosClause`); senão, not_found. */
export function findVisible(conn: Conn, actor: Actor, id: number, opts?: ServiceOptions): PortfolioRow {
  const row = findScoped(conn, actor, id);
  const clause = visiblePortfoliosClause(actor, opts);
  if (clause && !conn.get(sql`select 1 from portfolios where ${and(sql`id = ${id}`, clause)}`)) {
    throw notFound();
  }
  return row;
}

/**
 * Leitura dos dados DENTRO da carteira (prévia, ajustes, atribuições, vínculos): leitura ampla ou ser o
 * responsável; os demais recebem not_found, como fora do escopo. A edição segue em `openForEdit`.
 */
export function findReadable(conn: Conn, actor: Actor, id: number, opts?: ServiceOptions): PortfolioRow {
  const row = findScoped(conn, actor, id);
  if (row.responsibleSub !== actor.sub && !canReadBroadly(actor, opts, 'portfolio-data')) throw notFound();
  return row;
}

/** Incrementa a versão do agregado uma vez e registra a auditoria. */
export function bump(
  conn: Conn,
  row: PortfolioRow,
  actor: Actor,
  at: number,
  extra: Partial<PortfolioRow> = {},
): void {
  conn
    .update(portfolios)
    .set({ ...extra, version: row.version + 1, updatedAt: at, updatedBy: actor.sub })
    .where(eq(portfolios.id, row.id))
    .run();
}

/**
 * Passos comuns das escritas, nesta ordem: carteira no escopo (404), permissão de edição (403),
 * `beforeVersion` (permissões extras que dependem do corpo), versão presente (428), carteira
 * ativa (409 `portfolio_inactive`) e versão igual à atual (409 `version_conflict`).
 * A inativa vem antes da versão: com a versão velha, o 409 de versão mandaria recarregar e
 * tentar de novo, e o erro certo (reativar) só apareceria depois.
 */
export function openForEdit(
  conn: Conn,
  actor: Actor,
  id: number,
  expected: number | undefined,
  beforeVersion?: (row: PortfolioRow) => void,
): PortfolioRow {
  const row = findScoped(conn, actor, id);
  requireEdit(actor, row);
  beforeVersion?.(row);
  const version = requireVersion(expected);
  if (!row.active) throw new DomainError('portfolio_inactive', INACTIVE);
  assertVersion(row.version, version);
  return row;
}
