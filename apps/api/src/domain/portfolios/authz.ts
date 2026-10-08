import { isAdmin, type Actor } from '../shared/authz.js';
import { forbidden } from '../shared/errors.js';

/**
 * Regras por dono. A leitura/escopo por filial é checada antes (fora do escopo vira `not_found`);
 * aqui o ator já enxerga a filial da carteira no token.
 */

/** Admin da filial ou o responsável editam informações, filtros e vendedores. */
export function canEdit(actor: Actor, portfolio: { responsibleSub: string }): boolean {
  return isAdmin(actor) || actor.sub === portfolio.responsibleSub;
}

/** Trocar filial ou responsável, inativar e reativar: só admin. */
export function canAdminister(actor: Actor): boolean {
  return isAdmin(actor);
}

export function requireEdit(actor: Actor, portfolio: { responsibleSub: string }): void {
  if (!canEdit(actor, portfolio)) throw forbidden('Requer perfil administrador ou ser o responsável');
}

export function requireAdminister(actor: Actor): void {
  if (!canAdminister(actor)) throw forbidden('Requer perfil administrador');
}
