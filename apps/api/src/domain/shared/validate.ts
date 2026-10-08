import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { invalid } from './errors.js';
import { trimCollapse } from './normalize.js';

const SAFE_PATH = /^[\w/.-]{1,60}$/;

/** Valida com TypeBox. A mensagem cita só o caminho do campo, nunca o valor. */
export function parseInput<T extends TSchema>(schema: T, input: unknown): Static<T> {
  if (Value.Check(schema, input)) return input;
  const path = Value.Errors(schema, input).First()?.path ?? '';
  throw invalid(`Campo inválido: ${SAFE_PATH.test(path) ? path : 'corpo'}`);
}

/** Texto obrigatório: trim + colapso de espaços; vazio vira validation_error. */
export function cleanText(value: string, field: string): string {
  const out = trimCollapse(value);
  if (out === '') throw invalid(`Campo obrigatório: ${field}`);
  return out;
}

/** Texto opcional/anulável: ausente, null ou vazio viram null. */
export function cleanOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const out = trimCollapse(value);
  return out === '' ? null : out;
}

/** Código do ERP: trim, não vazio e sem espaço interno. */
export function cleanCode(value: string): string {
  const out = cleanText(value, 'code');
  if (/\s/.test(out)) throw invalid('Campo inválido: code');
  return out;
}
