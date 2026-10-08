import { Type } from '@sinclair/typebox';
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { assertVersion, writeVersionBump, type AuditedTable } from './audit.js';
import { assertAllInScope } from './authz.js';
import type { Conn } from './db.js';
import { forbidden, invalid } from './errors.js';

/** Filial do vínculo. `active` é o estado do VÍNCULO (não o da filial): ver `applyLinkActiveTransition`. */
export const BranchRefSchema = Type.Object({
  id: Type.Integer(),
  code: Type.String(),
  name: Type.String(),
  active: Type.Boolean({ description: 'Estado do vínculo do cadastro com esta filial.' }),
});
export interface BranchRef {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

/** Resposta do link por CNPJ/código: só identifica o registro e dá a versão (If-Match), sem dados. */
export const LinkResultSchema = Type.Object({
  id: Type.Integer(),
  version: Type.Integer(),
});
export interface LinkResult {
  id: number;
  version: number;
}

export interface OwnerLink {
  branchId: number;
  active: boolean;
}

export interface ScopedLink extends BranchRef {
  deactivatedAt: number | null;
}

/**
 * Repositório de uma tabela de vínculo N:N com `branches` (customer_branches / seller_branches).
 * Os nomes de tabela/coluna vêm de uma união fechada de literais (nunca de entrada externa),
 * então `sql.raw` é seguro; todos os valores vão como parâmetros.
 */
export interface LinkRepo {
  /** Cláusula "o dono tem vínculo (ativo ou não) com alguma filial do escopo". */
  visibleClause(ownerId: AnyColumn, scopeIds: number[]): SQL;
  /** "Ativo para o ator": registro global ativo E ao menos um vínculo ATIVO do escopo. */
  effectiveActiveClause(ownerActive: AnyColumn, ownerId: AnyColumn, scopeIds: number[]): SQL;
  links(conn: Conn, ownerId: number): OwnerLink[];
  branchIdsOf(conn: Conn, ownerId: number): number[];
  add(conn: Conn, ownerId: number, branchIds: number[], sub: string, at: number): void;
  remove(conn: Conn, ownerId: number, branchIds: number[]): void;
  /** Liga/desliga só os vínculos pedidos que ainda não estão no estado desejado. */
  setActive(conn: Conn, ownerId: number, branchIds: number[], active: boolean, sub: string, at: number): void;
  /** Vínculos de cada dono restritos ao escopo do ator (ordenados por código da filial). */
  scopedBranches(conn: Conn, ownerIds: number[], scopeIds: number[]): Map<number, ScopedLink[]>;
}

function idList(ids: number[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

export function makeLinkRepo(
  tableName: 'customer_branches' | 'seller_branches',
  ownerColumn: 'customer_id' | 'seller_id',
): LinkRepo {
  const table = sql.raw(tableName);
  const owner = sql.raw(ownerColumn);
  const readLinks = (conn: Conn, ownerId: number): OwnerLink[] =>
    conn
      .all<{ branch_id: number; active: number }>(
        sql`select branch_id, active from ${table} where ${owner} = ${ownerId}`,
      )
      .map((r) => ({ branchId: r.branch_id, active: r.active === 1 }));
  return {
    visibleClause(ownerId, scopeIds) {
      if (scopeIds.length === 0) return sql`0 = 1`;
      return sql`${ownerId} in (select ${owner} from ${table} where branch_id in (${idList(scopeIds)}))`;
    },
    effectiveActiveClause(ownerActive, ownerId, scopeIds) {
      if (scopeIds.length === 0) return sql`0 = 1`;
      return sql`(${ownerActive} = 1 and ${ownerId} in (select ${owner} from ${table} where branch_id in (${idList(scopeIds)}) and active = 1))`;
    },
    links: readLinks,
    branchIdsOf(conn, ownerId) {
      return readLinks(conn, ownerId).map((l) => l.branchId);
    },
    add(conn, ownerId, branchIds, sub, at) {
      for (const branchId of branchIds) {
        conn.run(
          sql`insert into ${table} (${owner}, branch_id, active, updated_at, updated_by)
              values (${ownerId}, ${branchId}, 1, ${at}, ${sub})`,
        );
      }
    },
    remove(conn, ownerId, branchIds) {
      if (branchIds.length === 0) return;
      conn.run(sql`delete from ${table} where ${owner} = ${ownerId} and branch_id in (${idList(branchIds)})`);
    },
    setActive(conn, ownerId, branchIds, active, sub, at) {
      if (branchIds.length === 0) return;
      conn.run(
        sql`update ${table}
            set active = ${active ? 1 : 0}, deactivated_at = ${active ? null : at},
                updated_at = ${at}, updated_by = ${sub}
            where ${owner} = ${ownerId} and branch_id in (${idList(branchIds)}) and active != ${active ? 1 : 0}`,
      );
    },
    scopedBranches(conn, ownerIds, scopeIds) {
      const out = new Map<number, ScopedLink[]>();
      if (ownerIds.length === 0 || scopeIds.length === 0) return out;
      const rows = conn.all<{
        owner_id: number;
        id: number;
        code: string;
        name: string;
        active: number;
        deactivated_at: number | null;
      }>(
        sql`select l.${owner} as owner_id, b.id as id, b.code as code, b.name as name,
                   l.active as active, l.deactivated_at as deactivated_at
            from ${table} l join branches b on b.id = l.branch_id
            where l.${owner} in (${idList(ownerIds)}) and l.branch_id in (${idList(scopeIds)})
            order by b.code`,
      );
      for (const r of rows) {
        const list = out.get(r.owner_id) ?? [];
        list.push({
          id: r.id,
          code: r.code,
          name: r.name,
          active: r.active === 1,
          deactivatedAt: r.deactivated_at,
        });
        out.set(r.owner_id, list);
      }
      return out;
    },
  };
}

export const customerLinks = makeLinkRepo('customer_branches', 'customer_id');
export const sellerLinks = makeLinkRepo('seller_branches', 'seller_id');

/** Remove o campo interno `deactivatedAt` das filiais devolvidas na resposta. */
export function publicBranches(links: ScopedLink[] | undefined): BranchRef[] {
  return (links ?? []).map(({ id, code, name, active }) => ({ id, code, name, active }));
}

/**
 * Estado do registro VISTO PELO ATOR: ativo = registro global ativo E ao menos um vínculo ativo
 * dentro do escopo dele. Quando inativo, `deactivatedAt` é o do registro (se foi inativado
 * globalmente) ou o mais recente entre os vínculos do escopo.
 */
export function effectiveState(
  row: { active: boolean; deactivatedAt: number | null },
  scoped: ScopedLink[] | undefined,
): { active: boolean; deactivatedAt: number | null } {
  const links = scoped ?? [];
  const active = row.active && links.some((l) => l.active);
  if (active) return { active: true, deactivatedAt: null };
  if (!row.active) return { active: false, deactivatedAt: row.deactivatedAt };
  const stamps = links.map((l) => l.deactivatedAt).filter((v): v is number => v !== null);
  return { active: false, deactivatedAt: stamps.length > 0 ? Math.max(...stamps) : null };
}

/** O ator cobre TODAS as filiais vinculadas ao registro (condição para mexer em dado compartilhado). */
export function coversAllBranches(linkedBranchIds: number[], scopeIds: number[]): boolean {
  const scope = new Set(scopeIds);
  return linkedBranchIds.every((id) => scope.has(id));
}

/**
 * Inativar/reativar um cadastro compartilhado entre filiais (cliente, vendedor): escopo VÍNCULO.
 *
 * SEMÂNTICA: age SEMPRE e SÓ nos vínculos das filiais do token que o registro tem no escopo,
 * por vínculo e de forma idempotente. O `active` global NUNCA muda aqui, mesmo que o ator cubra
 * todas as filiais do registro (para isso existe `applyGlobalActiveTransition`).
 * Algo mudou -> confere o If-Match e incrementa a versão uma vez. Nada mudou -> no-op sem exigir
 * versão (idempotente).
 */
export function applyLinkActiveTransition(args: {
  conn: Conn;
  repo: LinkRepo;
  table: AuditedTable;
  row: { id: number; active: boolean; version: number };
  scopeIds: number[];
  active: boolean;
  expectedVersion: number;
  sub: string;
  at: number;
}): void {
  const { conn, repo, table, row, scopeIds, active } = args;
  const scope = new Set(scopeIds);
  const toChange = repo
    .links(conn, row.id)
    .filter((l) => scope.has(l.branchId) && l.active !== active)
    .map((l) => l.branchId);
  if (toChange.length === 0) return;
  assertVersion(row.version, args.expectedVersion);
  repo.setActive(conn, row.id, toChange, active, args.sub, args.at);
  writeVersionBump(conn, table, row.id, args.sub, args.at);
}

/**
 * Inativar/reativar o registro GLOBAL (`active` do cadastro), sem tocar nos vínculos.
 * Exige que o ator cubra TODAS as filiais vinculadas ao registro (senão 403 `forbidden`, sem
 * alterar nada). Já no estado pedido -> no-op idempotente; senão confere o If-Match e
 * incrementa a versão uma vez.
 */
export function applyGlobalActiveTransition(args: {
  conn: Conn;
  repo: LinkRepo;
  table: AuditedTable;
  row: { id: number; active: boolean; version: number };
  scopeIds: number[];
  active: boolean;
  expectedVersion: number;
  sub: string;
  at: number;
}): void {
  const { conn, repo, table, row, scopeIds, active } = args;
  if (!coversAllBranches(repo.branchIdsOf(conn, row.id), scopeIds)) {
    throw forbidden('Alterar o estado global exige todas as filiais do cadastro no token');
  }
  if (row.active === active) return;
  assertVersion(row.version, args.expectedVersion);
  writeVersionBump(conn, table, row.id, args.sub, args.at, { active });
}

export interface LinkPlan {
  toAdd: number[];
  toRemove: number[];
}

/** Toda filial a ligar precisa estar ativa (vincular a filial inativa não faz sentido). */
export function assertBranchesActive(conn: Conn, branchIds: number[]): void {
  if (branchIds.length === 0) return;
  const rows = conn.all<{ n: number }>(
    sql`select count(*) as n from branches where id in (${idList(branchIds)}) and active = 1`,
  );
  if ((rows[0]?.n ?? 0) !== branchIds.length) throw invalid('Filial inativa ou inexistente');
}

/**
 * Plano de alteração dos vínculos. `desired` é o conjunto desejado DENTRO do escopo do ator:
 * vínculos com filiais fora do escopo são preservados (o ator nem os enxerga). Toda filial
 * adicionada ou removida está, por construção, no escopo. O registro não pode ficar sem filial.
 */
export function planLinkChange(
  repo: LinkRepo,
  conn: Conn,
  ownerId: number,
  desired: number[],
  scopeIds: number[],
): LinkPlan {
  assertAllInScope(desired, scopeIds);
  const current = repo.branchIdsOf(conn, ownerId);
  const scope = new Set(scopeIds);
  const want = new Set(desired);
  const have = new Set(current);
  const toAdd = [...want].filter((id) => !have.has(id));
  const toRemove = current.filter((id) => scope.has(id) && !want.has(id));
  if (current.length - toRemove.length + toAdd.length < 1) {
    throw invalid('O registro precisa ter ao menos uma filial');
  }
  assertBranchesActive(conn, toAdd);
  return { toAdd, toRemove };
}
