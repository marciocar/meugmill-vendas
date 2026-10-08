import { ADMIN_ROLE, type Actor } from '../shared/authz.js';
import type { ServiceOptions } from '../shared/db.js';

/**
 * Perfis de visibilidade (E8), lidos da claim `roles`. [INFERIDO] Os nomes são palpite de trabalho,
 * ainda a confirmar com a GMill: ficam todos aqui, para trocar sem mexer em regra.
 */
export const PROFILE = {
  seller: 'vendedor',
  manager: 'gestor',
  admin: ADMIN_ROLE,
  supervision: 'supervisao',
} as const;

export type Profile = (typeof PROFILE)[keyof typeof PROFILE];

/** Ordem estável das respostas. */
const ALL_PROFILES: readonly Profile[] = [
  PROFILE.admin,
  PROFILE.supervision,
  PROFILE.manager,
  PROFILE.seller,
];

/** `legacy`: nenhum perfil conhecido; lê como antes do E8 (toda a filial do token). Risco aberto. */
export type AccessMode = 'profiles' | 'legacy';

/** Perfis conhecidos presentes em `roles` (vários somam). */
export function effectiveProfiles(actor: Actor): Profile[] {
  return ALL_PROFILES.filter((p) => actor.roles.includes(p));
}

export function accessMode(actor: Actor): AccessMode {
  return effectiveProfiles(actor).length === 0 ? 'legacy' : 'profiles';
}

export function hasProfile(actor: Actor, profile: Profile): boolean {
  return actor.roles.includes(profile);
}

/**
 * Leitura ampla da filial do token: admin, supervisão ou `legacy`. É o único lugar que decide
 * "lê tudo"; quando for por `legacy`, avisa pelo gancho injetado (sem dado pessoal).
 */
export function canReadBroadly(actor: Actor, opts: ServiceOptions | undefined, resource: string): boolean {
  if (hasProfile(actor, PROFILE.admin) || hasProfile(actor, PROFILE.supervision)) return true;
  if (accessMode(actor) !== 'legacy') return false;
  opts?.onLegacyAccess?.(resource);
  return true;
}

/** Supervisão (sem admin) é só leitura: nenhuma escrita, nem como responsável de carteira. */
export function isReadOnly(actor: Actor): boolean {
  return hasProfile(actor, PROFILE.supervision) && !hasProfile(actor, PROFILE.admin);
}
