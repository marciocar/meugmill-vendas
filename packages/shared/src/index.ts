/**
 * Identidade mínima do usuário autenticado, derivada do JWT do IdP do sistema principal.
 * Minimização (LGPD): só o necessário para autorização — nada de CPF, nome ou e-mail.
 * [INFERIDO] Os nomes das claims de origem dependem do IdP da GMill; o mapeamento fica na API, por config.
 */
export interface UserClaims {
  /** Identificador estável do usuário no IdP (claim `sub`). */
  sub: string;
  /** Perfis de acesso (ex.: vendedor, administrador). */
  roles: string[];
  /** Filiais às quais o usuário tem acesso. */
  branchIds: string[];
}
