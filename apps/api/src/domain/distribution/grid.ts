import { eq, sql } from 'drizzle-orm';
import { portfolioSellers, portfolios, sellerBranches, sellers } from '../../db/schema.js';
import { effectiveMembers } from '../conflicts/members.js';
import type { PortfolioRow } from '../portfolios/access.js';
import type { Conn } from '../shared/db.js';
import { notFound } from '../shared/errors.js';

export type CellStatus = 'assigned' | 'unassigned' | 'stale';

/** Par (vendedor, subgrupo) da carteira, com a situação do vendedor. */
export interface PairInfo {
  subgroupId: number;
  sellerId: number;
  sellerCode: string;
  /** Vendedor ativo E com vínculo ativo com a filial da carteira. */
  usable: boolean;
}

/** Retrato do que é válido numa carteira: membros efetivos (E5) e pares (vendedor, subgrupo) (E3). */
export interface Grid {
  portfolioId: number;
  /** Membros efetivos (`assigned` do E5), em ordem crescente de id. */
  memberIds: number[];
  members: Set<number>;
  /** Subgrupos distintos de `portfolio_sellers`, em ordem crescente. */
  subgroupIds: number[];
  pairs: PairInfo[];
  /** Subgrupo -> vendedores utilizáveis. */
  usable: Map<number, Set<number>>;
}

export function loadGrid(conn: Conn, portfolio: PortfolioRow, opts: { members?: boolean } = {}): Grid {
  const withMembers = opts.members ?? true;
  const rows = conn
    .select({
      subgroupId: portfolioSellers.productSubgroupId,
      sellerId: portfolioSellers.sellerId,
      sellerCode: sellers.code,
      sellerActive: sellers.active,
      linked: sql<number>`exists (select 1 from ${sellerBranches} sb where sb.seller_id = ${portfolioSellers.sellerId} and sb.branch_id = ${portfolio.branchId} and sb.active = 1)`,
    })
    .from(portfolioSellers)
    .innerJoin(sellers, eq(sellers.id, portfolioSellers.sellerId))
    .where(eq(portfolioSellers.portfolioId, portfolio.id))
    .all();
  const pairs: PairInfo[] = rows.map((r) => ({
    subgroupId: r.subgroupId,
    sellerId: r.sellerId,
    sellerCode: r.sellerCode,
    usable: r.sellerActive && r.linked === 1,
  }));
  const subgroupIds = [...new Set(pairs.map((p) => p.subgroupId))].sort((a, b) => a - b);
  const usable = new Map<number, Set<number>>(subgroupIds.map((g) => [g, new Set<number>()]));
  for (const p of pairs) if (p.usable) (usable.get(p.subgroupId) as Set<number>).add(p.sellerId);

  const memberIds: number[] = [];
  if (withMembers) for (const m of effectiveMembers(conn, portfolio.id)) memberIds.push(m.customerId);
  return { portfolioId: portfolio.id, memberIds, members: new Set(memberIds), subgroupIds, pairs, usable };
}

/**
 * REGRA DE VALIDADE (único lugar). Uma atribuição gravada (cliente, subgrupo, vendedor) é válida quando:
 *  1. o cliente é membro efetivo da carteira (`assigned` do E5);
 *  2. o par (vendedor, subgrupo) está em `portfolio_sellers` da carteira;
 *  3. o vendedor está ativo e tem vínculo ativo com a filial da carteira (itens 2 e 3 em `grid.usable`).
 * Toda leitura (status, resumo), a edição manual e a distribuição passam por aqui.
 */
export function isValidAssignment(
  grid: Grid,
  customerId: number,
  subgroupId: number,
  sellerId: number,
): boolean {
  return invalidReason(grid, customerId, subgroupId, sellerId) === null;
}

/**
 * Por que a atribuição não vale (mensagens fixas, sem eco do que foi enviado); null quando vale.
 * É a única implementação da regra: `isValidAssignment` deriva daqui.
 */
export function invalidReason(
  grid: Grid,
  customerId: number,
  subgroupId: number,
  sellerId: number,
): string | null {
  if (!grid.members.has(customerId)) return 'Cliente não é membro efetivo da carteira';
  if (!grid.usable.has(subgroupId)) return 'Subgrupo não pertence à carteira';
  if (!grid.usable.get(subgroupId)?.has(sellerId)) return 'Vendedor inválido para o subgrupo da carteira';
  return null;
}

export interface Cell {
  customerId: number;
  subgroupId: number;
  /** Vendedor gravado (vale para `assigned` e `stale`); null em `unassigned`. */
  sellerId: number | null;
  status: CellStatus;
  /** A célula pertence à grade (membro efetivo × subgrupo da carteira). `stale` pode estar fora dela. */
  inGrid: boolean;
}

export interface StoredAssignment {
  c: number;
  g: number;
  s: number;
}

/** Atribuições gravadas, em ordem de (cliente, subgrupo) (índice da PK, sem ordenar). */
export function loadStored(conn: Conn, portfolioId: number): StoredAssignment[] {
  return conn.all<StoredAssignment>(
    sql`select customer_id as c, product_subgroup_id as g, seller_id as s from portfolio_assignments where portfolio_id = ${portfolioId} order by customer_id, product_subgroup_id`,
  );
}

/**
 * Todas as células em ordem de (cliente, subgrupo): a grade inteira mais as atribuições gravadas fora
 * dela (cliente que deixou de ser membro, subgrupo que saiu da carteira), que são `stale`.
 */
export function* cells(grid: Grid, stored: StoredAssignment[]): Generator<Cell, void, void> {
  const { memberIds, subgroupIds } = grid;
  const N = stored.length;
  const M = memberIds.length;
  const S = subgroupIds.length;
  let i = 0;
  let m = 0;
  while (m < M || i < N) {
    const mc = m < M ? (memberIds[m] as number) : Infinity;
    const sc = i < N ? (stored[i] as StoredAssignment).c : Infinity;
    const customerId = Math.min(mc, sc);
    const isMember = mc === customerId;
    if (isMember) m++;
    let j = i;
    while (j < N && (stored[j] as StoredAssignment).c === customerId) j++;
    let s = 0;
    let k = i;
    while ((isMember && s < S) || k < j) {
      const gridG = isMember && s < S ? (subgroupIds[s] as number) : Infinity;
      const storedG = k < j ? (stored[k] as StoredAssignment).g : Infinity;
      const subgroupId = Math.min(gridG, storedG);
      const inGrid = gridG === subgroupId;
      if (inGrid) s++;
      let sellerId: number | null = null;
      if (storedG === subgroupId) sellerId = (stored[k++] as StoredAssignment).s;
      const status: CellStatus =
        sellerId === null
          ? 'unassigned'
          : isValidAssignment(grid, customerId, subgroupId, sellerId)
            ? 'assigned'
            : 'stale';
      yield { customerId, subgroupId, sellerId, status, inGrid };
    }
    i = j;
  }
}

/**
 * Grade inteira, sem paginação: todas as células (inclusive `stale` fora da grade) com status e vendedor,
 * em ordem de (cliente, subgrupo). Feita para o E7 finalizar a carteira sem percorrer páginas.
 *
 * CUSTO: refaz a disputa do E5 (membros efetivos) uma vez e materializa todas as células em memória
 * (O(membros x subgrupos)). Chame UMA vez por finalização e DENTRO da transação de escrita do E7, para
 * que a leitura e a escrita enxerguem o mesmo retrato.
 */
export function loadAssignmentGrid(conn: Conn, portfolioId: number): Cell[] {
  const portfolio = conn.select().from(portfolios).where(eq(portfolios.id, portfolioId)).get();
  if (!portfolio) throw notFound();
  return [...cells(loadGrid(conn, portfolio), loadStored(conn, portfolioId))];
}
