import { or, type SQL } from 'drizzle-orm';
import { customers } from '../../db/schema.js';
import { normalizeCnpj } from '../shared/cnpj.js';
import { keyContains, likeContains } from '../shared/sql.js';

/** Busca de cliente por razão social, fantasia (sem acento/caixa) ou trecho do CNPJ. */
export function customerSearchClause(rawQuery: string | undefined): SQL | undefined {
  const q = rawQuery?.trim();
  if (!q) return undefined;
  const digits = normalizeCnpj(q);
  return or(
    keyContains(customers.legalNameKey, q),
    keyContains(customers.tradeNameKey, q),
    digits ? likeContains(customers.cnpj, digits) : undefined,
  );
}
