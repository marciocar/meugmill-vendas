import { eq } from 'drizzle-orm';
import { portfolios } from '../../db/schema.js';
import { isUniqueViolation, type Db } from '../shared/db.js';
import { searchKey } from '../shared/normalize.js';

/**
 * Chave do nome da carteira: `searchKey` (caixa, acento, espaços) e, além disso, qualquer sequência
 * de caracteres que não seja letra nem dígito (pontuação, travessões, hífens, barras) vira um único
 * espaço. "Norte — Farmácias", "norte - farmacias" e "NORTE/FARMÁCIAS" dão "NORTE FARMACIAS".
 * Vazio significa que o nome não tem letra nem dígito.
 */
export function portfolioNameKey(value: string): string {
  return searchKey(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Recalcula `name_key` das carteiras gravadas com a normalização anterior (só `searchKey`).
 * Idempotente: só toca linhas cuja chave mudou. Se duas carteiras da mesma filial passarem a
 * colidir, a segunda mantém a chave antiga (o banco não é violado) e segue editável.
 */
export function refreshPortfolioNameKeys(db: Db): number {
  let changed = 0;
  for (const row of db
    .select({ id: portfolios.id, name: portfolios.name, nameKey: portfolios.nameKey })
    .from(portfolios)
    .all()) {
    const key = portfolioNameKey(row.name);
    if (key === '' || key === row.nameKey) continue;
    try {
      db.update(portfolios).set({ nameKey: key }).where(eq(portfolios.id, row.id)).run();
      changed++;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return changed;
}
