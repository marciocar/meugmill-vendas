import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { containsPattern } from './pagination.js';

/** `col LIKE '%q%'` com escape (LIKE do SQLite é case-insensitive para ASCII). */
export function likeContains(column: AnyColumn, q: string): SQL {
  return sql`${column} like ${containsPattern(q)} escape '\\'`;
}
