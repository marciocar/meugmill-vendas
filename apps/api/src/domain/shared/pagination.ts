import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { invalid } from './errors.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export const ListQuerySchema = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: 100 })),
    active: Type.Optional(Type.Boolean()),
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT })),
  },
  { additionalProperties: false },
);
export type ListParams = Static<typeof ListQuerySchema>;

export const PageSchema = <T extends TSchema>(item: T) =>
  Type.Object({
    items: Type.Array(item),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  });

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Cursor opaco: base64url do último id entregue. */
export function encodeCursor(id: number): string {
  return Buffer.from(String(id), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): number | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^\d{1,15}$/.test(text)) throw invalid('Campo inválido: cursor');
  return Number(text);
}

export function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalid('Campo inválido: limit');
  }
  return limit;
}

/** `rows` deve ter sido buscada com `limit + 1` linhas, em ordem crescente de id. */
export function toPage<T>(rows: T[], limit: number, idOf: (row: T) => number): Page<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: last === undefined ? null : encodeCursor(idOf(last)) };
}

/** Padrão LIKE "contém", com %, _ e \ escapados (usar com `escape '\'`). */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}
