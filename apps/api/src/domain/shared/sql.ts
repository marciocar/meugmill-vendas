import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { searchKey } from './normalize.js';
import { containsPattern } from './pagination.js';

/** `col LIKE '%q%'` com escape (LIKE do SQLite é case-insensitive para ASCII). */
export function likeContains(column: AnyColumn, q: string): SQL {
  return sql`${column} like ${containsPattern(q)} escape '\\'`;
}

/**
 * Busca acento e caixa-insensível: compara a chave normalizada de `q` com uma coluna `*_key`
 * (já normalizada na gravação). Mantém o escape de `%`, `_` e `\`.
 */
export function keyContains(keyColumn: AnyColumn, q: string): SQL {
  return likeContains(keyColumn, searchKey(q));
}
