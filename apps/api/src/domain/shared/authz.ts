import { inArray } from 'drizzle-orm';
import type { UserClaims } from '@meugmill/shared';
import { branches } from '../../db/schema.js';
import type { Conn } from './db.js';
import { forbidden } from './errors.js';

export const ADMIN_ROLE = 'admin';

/** Quem está agindo. `branchCodes` são os códigos de filial do token (`branches.code`). [INFERIDO] */
export interface Actor {
  sub: string;
  roles: string[];
  branchCodes: string[];
}

export function toActor(claims: UserClaims): Actor {
  return {
    sub: claims.sub,
    roles: [...claims.roles],
    branchCodes: [...new Set(claims.branchIds)],
  };
}

export function isAdmin(actor: Actor): boolean {
  return actor.roles.includes(ADMIN_ROLE);
}

/** Escrita é só do perfil admin (403 caso contrário). */
export function requireAdmin(actor: Actor): void {
  if (!isAdmin(actor)) throw forbidden('Requer perfil administrador');
}

export interface ScopeBranch {
  id: number;
  code: string;
}

/**
 * Resolve os códigos de filial do token para as linhas de `branches`.
 *
 * Inclui filiais ATIVAS E INATIVAS: o escopo é por vínculo com o token, não por situação da filial.
 * Inativar uma filial não pode esconder o histórico dos clientes e vendedores ligados a ela, nem
 * impedir que o admin da filial a reative. Códigos do token sem filial cadastrada são ignorados.
 */
export function resolveScopeBranches(conn: Conn, actor: Actor): ScopeBranch[] {
  if (actor.branchCodes.length === 0) return [];
  return conn
    .select({ id: branches.id, code: branches.code })
    .from(branches)
    .where(inArray(branches.code, actor.branchCodes))
    .all();
}

export function resolveScopeIds(conn: Conn, actor: Actor): number[] {
  return resolveScopeBranches(conn, actor).map((b) => b.id);
}

/** Interseção não vazia entre as filiais do registro e as do escopo. */
export function intersects(recordBranchIds: number[], scopeIds: number[]): boolean {
  const scope = new Set(scopeIds);
  return recordBranchIds.some((id) => scope.has(id));
}

/** Toda filial pedida precisa estar no escopo (inexistente conta como fora, sem distinguir). */
export function assertAllInScope(requested: number[], scopeIds: number[]): void {
  const scope = new Set(scopeIds);
  if (requested.some((id) => !scope.has(id))) {
    throw forbidden('Filial fora do escopo do usuário');
  }
}
