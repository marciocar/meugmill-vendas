import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../../db/schema.js';

export type Db = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Conexão ou transação: os repositórios aceitam as duas. */
export type Conn = Db | Tx;

export interface ServiceOptions {
  /** Relógio injetável (epoch ms); default `Date.now`. */
  now?: () => number;
  /**
   * Aviso de acesso em modo `legacy` (E8): o ator não tem nenhum perfil conhecido e lê como antes.
   * Recebe só o nome do recurso lido; nunca `sub`, papéis, filiais nem dado de negócio.
   */
  onLegacyAccess?: (resource: string) => void;
  /**
   * Modo do token sem perfil conhecido (E8): `allow` (default) lê como antes; `deny` não lê nada amplo
   * (trata como vendedor sem vínculos). Vem de `VISIBILITY_LEGACY`.
   */
  visibilityLegacy?: 'allow' | 'deny';
  /** Aviso de papel "quase conhecido" (ex.: "Admin"), recusado com 403. Sem `sub` nem papéis. */
  onRoleMismatch?: () => void;
}

/** Violação de UNIQUE/PK do better-sqlite3 (rede de segurança além do pré-check). */
export function isUniqueViolation(err: unknown): boolean {
  // O Drizzle embrulha o erro do driver em `cause`.
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 3; e = e.cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
  }
  return false;
}

/**
 * Escritas rodam em transação síncrona do better-sqlite3. `immediate` pega o lock de escrita no
 * início e evita SQLITE_BUSY ao promover leitura em escrita. Qualquer exceção desfaz tudo.
 */
export function writeTx<T>(db: Db, fn: (tx: Tx) => T): T {
  return db.transaction(fn, { behavior: 'immediate' });
}
