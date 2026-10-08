import { ADMIN_ROLE, type Actor } from '../shared/authz.js';
import type { ServiceOptions } from '../shared/db.js';
import { forbidden } from '../shared/errors.js';

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

/**
 * `legacy`: nenhum perfil conhecido; lê como antes do E8 (toda a filial do token). Risco aberto.
 * `denied`: nenhum perfil conhecido e `VISIBILITY_LEGACY=deny`; não lê nada amplo.
 */
export type AccessMode = 'profiles' | 'legacy' | 'denied';

/** Perfis conhecidos presentes em `roles` (vários somam). */
export function effectiveProfiles(actor: Actor): Profile[] {
  return ALL_PROFILES.filter((p) => actor.roles.includes(p));
}

export function accessMode(actor: Actor, opts?: ServiceOptions): AccessMode {
  if (effectiveProfiles(actor).length > 0) return 'profiles';
  return opts?.visibilityLegacy === 'deny' ? 'denied' : 'legacy';
}

/**
 * Recusa (403) o token com papel "quase conhecido": após `trim().toLowerCase()` igual a um perfil
 * conhecido, mas não idêntico (ex.: "Admin", " admin", "VENDEDOR"). Evidencia o erro de configuração em
 * vez de cair em legacy. Avisa pelo gancho injetado, sem `sub` nem papéis.
 */
export function assertRolesWellFormed(actor: Actor, opts?: ServiceOptions): void {
  for (const role of actor.roles) {
    if (typeof role !== 'string') continue;
    const normalized = role.trim().toLowerCase();
    if (role !== normalized && (ALL_PROFILES as readonly string[]).includes(normalized)) {
      opts?.onRoleMismatch?.();
      throw forbidden('Papel inválido no token: use o nome exato do perfil');
    }
  }
}

/**
 * Envolve um service: toda operação (o primeiro argumento é o ator) começa pela checagem de
 * `assertRolesWellFormed`, em leitura e escrita.
 */
export function withRoleGuard<T extends object>(service: T, opts?: ServiceOptions): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(service)) {
    out[key] =
      typeof value === 'function'
        ? (...args: unknown[]) => {
            const first = args[0] as Actor | undefined;
            if (first && Array.isArray(first.roles)) assertRolesWellFormed(first, opts);
            return (value as (...a: unknown[]) => unknown)(...args);
          }
        : value;
  }
  return out as T;
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
  if (accessMode(actor, opts) !== 'legacy') return false;
  opts?.onLegacyAccess?.(resource);
  return true;
}

/** Supervisão (sem admin) é só leitura: nenhuma escrita, nem como responsável de carteira. */
export function isReadOnly(actor: Actor): boolean {
  return hasProfile(actor, PROFILE.supervision) && !hasProfile(actor, PROFILE.admin);
}
