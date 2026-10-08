import type { Conn } from '../shared/db.js';
import {
  conflictCounts,
  loadPortfolioCriteria,
  resolvedItems,
  type PreviewSource,
  type RegionLevel,
} from '../eligibility/query.js';

/** Cliente que segue para a distribuição (E6) e o vínculo (E7): `assigned` na carteira. */
export interface EffectiveMember {
  customerId: number;
  /** Posto de P para o cliente (6 = inclusão manual). */
  rank: number;
  source: PreviewSource;
  matchedRegionLevel: RegionLevel | null;
}

/**
 * Itera, em ordem crescente de id, os clientes `assigned` de P (sem disputa, ou com posto maior que o
 * de todas as concorrentes). `lost` e `blocked` ficam de fora. A disputa é resolvida uma única vez, no
 * início da iteração (retrato consistente por construção); sem cache entre chamadas. Guarda só ids e
 * metadados em memória (50 mil clientes são poucos MB).
 */
export function* effectiveMembers(db: Conn, portfolioId: number): Generator<EffectiveMember, void, void> {
  const items = resolvedItems(db, loadPortfolioCriteria(db, portfolioId), portfolioId, 'assigned');
  for (const i of items) {
    yield {
      customerId: i.customerId,
      rank: i.rank,
      source: i.source,
      matchedRegionLevel: i.matchedRegionLevel,
    };
  }
}

/** Contagens de conflito de P (clientes bloqueados e perdidos) sobre todos os clientes com posto em P. */
export function conflictTotals(db: Conn, portfolioId: number): { blocked: number; lost: number } {
  return conflictCounts(db, loadPortfolioCriteria(db, portfolioId), portfolioId);
}
