import type { BranchService } from '../../branches/service.js';
import type { CatalogService } from '../../catalog/service.js';
import type { CustomerService } from '../../customers/service.js';
import type { DistributionService } from '../../distribution/service.js';
import type { LinkService } from '../../links/service.js';
import type { PortfolioService } from '../../portfolios/service.js';
import type { SellerService } from '../../sellers/service.js';
import type { Actor } from '../../shared/authz.js';
import type { Db } from '../../shared/db.js';
import type { DomainErrorCode } from '../../shared/errors.js';
import type { Row } from '../layouts.js';

/** Efeito previsto (simulação) ou gravado (confirmação) de uma linha. */
export const ROW_ACTIONS = ['create', 'update', 'unchanged', 'linked'] as const;
export type RowAction = (typeof ROW_ACTIONS)[number];
export const ACTIVATIONS = ['deactivate', 'reactivate'] as const;
export type Activation = (typeof ACTIVATIONS)[number];

/** Código de erro da linha: os do domínio mais os do arquivo. */
export type RowErrorCode = DomainErrorCode | 'duplicate_key' | 'malformed_row' | 'changed_since_validation';

export interface RowOk {
  ok: true;
  action: RowAction;
  activation: Activation | null;
  /** Aviso fixo (sem eco), ex.: dados não alterados fora do escopo. */
  warning: string | null;
  /** Registro-alvo e versão lidos ANTES de gravar (a confirmação confere que não mudaram). */
  targetId: number | null;
  targetVersion: number | null;
}

export interface RowFail {
  ok: false;
  code: RowErrorCode;
  /** Mensagem fixa do domínio: nunca o valor enviado. */
  message: string;
}

export type RowResult = RowOk | RowFail;

export interface Services {
  branches: BranchService;
  productSubgroups: CatalogService;
  retailNetworks: CatalogService;
  economicGroups: CatalogService;
  sellers: SellerService;
  customers: CustomerService;
  portfolios: PortfolioService;
  distribution: DistributionService;
  links: LinkService;
}

/** Alvo esperado de uma linha na confirmação (o que a simulação leu). */
export interface Expected {
  targetId: number | null;
  targetVersion: number | null;
}

export interface ImportContext {
  db: Db;
  actor: Actor;
  services: Services;
  /** Na confirmação: o que a simulação viu, por linha. Na simulação: `undefined`. */
  expected?: ReadonlyMap<number, Expected>;
  /**
   * Contagens da unidade além das linhas (ex.: vínculos encerrados). O runner só as soma quando a
   * unidade inteira deu certo.
   */
  stats: Record<string, number>;
}

/**
 * Unidade de gravação: uma linha nos cadastros e nas carteiras; uma carteira inteira nos vínculos.
 * A unidade é atômica (um savepoint) e devolve um resultado por linha.
 */
export interface Unit {
  rows: Row[];
}

export interface Importer {
  /** Chave natural normalizada da linha, para achar repetidas no arquivo. `null` = a linha não tem chave válida. */
  keyOf(row: Row): string | null;
  /** Agrupa as linhas válidas em unidades (default: uma por linha). */
  units?(rows: Row[]): Unit[];
  /** Grava a unidade (dentro de um savepoint aberto pelo runner). Erro de domínio por linha vai no resultado. */
  apply(ctx: ImportContext, unit: Unit): Map<number, RowResult>;
}
