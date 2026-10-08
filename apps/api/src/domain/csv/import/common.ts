import { eq, inArray } from 'drizzle-orm';
import { branches } from '../../../db/schema.js';
import type { Conn } from '../../shared/db.js';
import type { Actor } from '../../shared/authz.js';
import { DomainError, forbidden, invalid } from '../../shared/errors.js';
import { trimCollapse } from '../../shared/normalize.js';
import { splitList } from '../codec.js';
import type { Row } from '../layouts.js';
import type { Activation, Expected, ImportContext, RowOk, RowResult } from './types.js';

/** Valor obrigatório da coluna (com trim); vazio é erro da linha. */
export function required(row: Row, column: string): string {
  const v = row.get(column);
  if (v === '') throw invalid(`Campo obrigatório: ${column}`);
  return v;
}

/** Código do ERP: sem espaço interno. */
export function code(row: Row, column: string): string {
  const v = required(row, column);
  if (/\s/.test(v)) throw invalid(`Campo inválido: ${column}`);
  return v;
}

export function optionalCode(row: Row, column: string): string | null {
  return row.get(column) === '' ? null : code(row, column);
}

export function integer(row: Row, column: string): number {
  const v = required(row, column);
  if (!/^\d{1,9}$/.test(v)) throw invalid(`Campo inválido: ${column}`);
  return Number(v);
}

/** `S`/`N` (sem diferença de caixa); vazio ou coluna ausente vale `S`. */
export function active(row: Row): boolean {
  const v = row.get('ativo').toUpperCase();
  if (v === '' || v === 'S') return true;
  if (v === 'N') return false;
  throw invalid('Campo inválido: ativo');
}

/** Lista de códigos (`a|b`), sem repetidos nem espaços internos. */
export function codeList(row: Row, column: string, opts: { required: boolean }): string[] {
  const items = splitList(row.get(column));
  if (opts.required && items.length === 0) throw invalid(`Campo obrigatório: ${column}`);
  if (items.some((i) => /\s/.test(i))) throw invalid(`Campo inválido: ${column}`);
  if (new Set(items).size !== items.length) throw invalid(`Item repetido: ${column}`);
  return items;
}

/** Texto como o domínio grava (trim + espaços colapsados). */
export const clean = trimCollapse;

/** Ids das filiais por código. Código sem filial cadastrada é erro da linha. */
export function branchIdsByCodes(conn: Conn, codes: string[], column: string): number[] {
  if (codes.length === 0) return [];
  const rows = conn
    .select({ id: branches.id, code: branches.code })
    .from(branches)
    .where(inArray(branches.code, codes))
    .all();
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  return codes.map((c) => {
    const id = byCode.get(c);
    if (id === undefined) throw invalid(`Código não encontrado: ${column}`);
    return id;
  });
}

export function branchIdByCode(conn: Conn, value: string, column: string): number {
  const row = conn.select({ id: branches.id }).from(branches).where(eq(branches.code, value)).get();
  if (!row) throw invalid(`Código não encontrado: ${column}`);
  return row.id;
}

/**
 * Filial da carteira (carteiras e vínculos): precisa estar no token ANTES de qualquer busca, para a
 * simulação não revelar o que existe em outra filial (mesma resposta para inexistente e fora do escopo).
 */
export function scopedBranchId(conn: Conn, actor: Actor, value: string, column: string): number {
  if (!actor.branchCodes.includes(value)) throw forbidden('Filial fora do escopo do usuário');
  return branchIdByCode(conn, value, column);
}

export function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function ok(
  action: RowOk['action'],
  target: { id: number; version: number } | null,
  activation: Activation | null = null,
  warning: string | null = null,
): RowOk {
  return {
    ok: true,
    action,
    activation,
    warning,
    targetId: target?.id ?? null,
    targetVersion: target?.version ?? null,
  };
}

/** Converte um erro de domínio em resultado de linha; outro erro sobe (falha do job). */
export function failOf(err: unknown): RowResult {
  if (err instanceof DomainError) return { ok: false, code: err.code, message: err.message };
  throw err;
}

export const CHANGED_SINCE_VALIDATION = 'Registro alterado depois da simulação: simule de novo';

/**
 * Na confirmação, o alvo precisa ser o mesmo que a simulação viu: mesmo id (ou ainda inexistente) e
 * mesma versão. Na simulação não confere nada.
 */
export function assertUnchangedSinceValidation(
  ctx: ImportContext,
  line: number,
  current: { id: number; version: number } | null,
): void {
  const exp: Expected | undefined = ctx.expected?.get(line);
  if (!exp) return;
  const same = (current?.id ?? null) === exp.targetId && (current?.version ?? null) === exp.targetVersion;
  if (!same) throw new DomainError('version_conflict', CHANGED_SINCE_VALIDATION);
}

/** Resultado único de uma linha numa unidade de uma linha só. */
export function single(row: Row, fn: () => RowResult): Map<number, RowResult> {
  let result: RowResult;
  try {
    result = fn();
  } catch (err) {
    result = failOf(err);
  }
  return new Map([[row.line, result]]);
}

/**
 * Aplica o `ativo` do arquivo depois dos dados: só chama o serviço quando o estado muda, com a versão
 * corrente. Devolve a ativação feita (ou `null`).
 */
export function applyActive(
  current: { active: boolean; version: number },
  desired: boolean,
  transitions: {
    deactivate: (version: number) => unknown;
    reactivate: (version: number) => unknown;
  },
): Activation | null {
  if (current.active === desired) return null;
  if (desired) {
    transitions.reactivate(current.version);
    return 'reactivate';
  }
  transitions.deactivate(current.version);
  return 'deactivate';
}
