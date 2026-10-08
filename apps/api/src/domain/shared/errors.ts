export type DomainErrorCode =
  | 'validation_error'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'customer_exists'
  | 'seller_exists'
  | 'portfolio_inactive'
  | 'portfolio_incomplete'
  | 'portfolio_has_conflicts'
  | 'link_conflict'
  | 'version_conflict'
  | 'precondition_required';

/** Status HTTP de cada código (usado pelas rotas das próximas fases). */
export const DOMAIN_ERROR_STATUS: Record<DomainErrorCode, number> = {
  validation_error: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  customer_exists: 409,
  seller_exists: 409,
  portfolio_inactive: 409,
  portfolio_incomplete: 409,
  portfolio_has_conflicts: 409,
  link_conflict: 409,
  version_conflict: 409,
  precondition_required: 428,
};

/**
 * Erro de regra de negócio. A mensagem é sempre um texto fixo do domínio: nunca carrega
 * o valor enviado pelo cliente (sem eco, LGPD).
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  /**
   * Detalhe estruturado opcional (contagens e ids de carteiras; nunca dados de clientes nem valores
   * enviados pelo cliente). As rotas decidem se o expõem.
   */
  readonly detail: Readonly<Record<string, number | readonly number[]>> | undefined;

  constructor(code: DomainErrorCode, message: string, detail?: DomainError['detail']) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.detail = detail;
  }

  get status(): number {
    return DOMAIN_ERROR_STATUS[this.code];
  }
}

export const forbidden = (message = 'Operação não permitida'): DomainError =>
  new DomainError('forbidden', message);
export const notFound = (): DomainError => new DomainError('not_found', 'Registro não encontrado');
export const invalid = (message: string): DomainError => new DomainError('validation_error', message);

export function orNotFound<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw notFound();
  return value;
}
