import type { Portfolio } from './api/types';
import type { Me } from './use-me';

/**
 * Permissões só para a TELA (esconder ou desabilitar o que sempre falharia). A API é a autoridade:
 * um 403/404 continua sendo mostrado como mensagem.
 */
export const isAdmin = (me: Me): boolean => me.roles.includes('admin');

/** Admin da filial da carteira (o token traz códigos de filial). */
export const isBranchAdmin = (me: Me, branchCode: string): boolean =>
  isAdmin(me) && me.branchIds.includes(branchCode);

/** Editar informações, filtros, vendedores, ajustes, distribuição e finalizar: admin da filial ou responsável. */
export function canEditPortfolio(
  me: Me,
  p: Pick<Portfolio, 'active' | 'responsibleSub' | 'branch'>,
): boolean {
  if (!p.active) return false;
  return isBranchAdmin(me, p.branch.code) || p.responsibleSub === me.sub;
}

/** Trocar filial ou responsável, inativar e reativar: só admin da filial. */
export const canAdminPortfolio = (me: Me, p: Pick<Portfolio, 'branch'>): boolean =>
  isBranchAdmin(me, p.branch.code);

/** Prévia, ajustes, distribuição e vínculos: leitura ampla (admin, supervisão) ou o responsável. */
export function canSeePortfolioDetails(me: Me, p: Pick<Portfolio, 'responsibleSub'>): boolean {
  return me.roles.includes('admin') || me.roles.includes('supervisao') || p.responsibleSub === me.sub;
}
