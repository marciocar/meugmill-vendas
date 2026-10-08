import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  economicGroups,
  municipalities,
  portfolioTypes,
  productSubgroups,
  retailNetworks,
  sellerBranches,
  sellers,
  states,
} from '../../db/schema.js';
import type { Conn } from '../shared/db.js';
import { invalid } from '../shared/errors.js';
import { neighborhoodKey, trimCollapse } from '../shared/normalize.js';
import type { RegionInput } from './schemas.js';

/** Região validada e pronta para gravar (com a chave do bairro calculada). */
export interface RegionRow {
  level: 'state' | 'municipality' | 'neighborhood';
  stateCode: number;
  municipalityCode: number | null;
  neighborhoodKey: string | null;
  neighborhoodLabel: string | null;
}

export function assertNoDuplicates<T>(items: T[], keyOf: (item: T) => string, message: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) throw invalid(message);
    seen.add(key);
  }
}

/** Tipo existente e ativo. */
export function assertActiveType(conn: Conn, id: number): void {
  const row = conn
    .select({ id: portfolioTypes.id })
    .from(portfolioTypes)
    .where(and(eq(portfolioTypes.id, id), eq(portfolioTypes.active, true)))
    .get();
  if (!row) throw invalid('Tipo de carteira inexistente ou inativo');
}

/** Redes de varejo existentes e ativas (ids já sem duplicata). */
export function assertActiveNetworks(conn: Conn, ids: number[]): void {
  if (ids.length === 0) return;
  const n = conn
    .select({ id: retailNetworks.id })
    .from(retailNetworks)
    .where(and(inArray(retailNetworks.id, ids), eq(retailNetworks.active, true)))
    .all().length;
  if (n !== ids.length) throw invalid('Rede de varejo inexistente ou inativa');
}

/** Grupos econômicos existentes e ativos (ids já sem duplicata). */
export function assertActiveGroups(conn: Conn, ids: number[]): void {
  if (ids.length === 0) return;
  const n = conn
    .select({ id: economicGroups.id })
    .from(economicGroups)
    .where(and(inArray(economicGroups.id, ids), eq(economicGroups.active, true)))
    .all().length;
  if (n !== ids.length) throw invalid('Grupo econômico inexistente ou inativo');
}

/** Chave canônica da região (espelha a coluna gerada `region_key`). */
const regionKeyOf = (r: RegionRow): string =>
  `${r.level}:${r.stateCode}:${r.municipalityCode ?? 0}:${r.neighborhoodKey ?? ''}`;

/**
 * Valida as regiões contra o IBGE e a coerência de nível, e calcula `neighborhoodKey`.
 * Duplicatas no mesmo conjunto (após normalizar o bairro) são `validation_error`.
 */
export function validateRegions(conn: Conn, input: RegionInput[]): RegionRow[] {
  const rows: RegionRow[] = input.map((r) => {
    if (r.level === 'state') {
      if (r.municipalityCode !== undefined || r.neighborhoodLabel !== undefined) {
        throw invalid('Região de estado não aceita município nem bairro');
      }
      return {
        level: 'state',
        stateCode: r.stateCode,
        municipalityCode: null,
        neighborhoodKey: null,
        neighborhoodLabel: null,
      };
    }
    if (r.municipalityCode === undefined) throw invalid('Região de município e bairro exige município');
    if (r.level === 'municipality') {
      if (r.neighborhoodLabel !== undefined) throw invalid('Região de município não aceita bairro');
      return {
        level: 'municipality',
        stateCode: r.stateCode,
        municipalityCode: r.municipalityCode,
        neighborhoodKey: null,
        neighborhoodLabel: null,
      };
    }
    const label = trimCollapse(r.neighborhoodLabel ?? '');
    const key = neighborhoodKey(label);
    // Sem letra nem dígito (só pontuação) não identifica bairro algum.
    if (label === '' || key === '' || !/[\p{L}\p{N}]/u.test(key))
      throw invalid('Região de bairro exige o nome do bairro');
    // `|` separa as regiões no CSV do E10: com ele o bairro não volta igual de uma exportação.
    if (label.includes('|')) throw invalid('Campo inválido: neighborhoodLabel');
    return {
      level: 'neighborhood',
      stateCode: r.stateCode,
      municipalityCode: r.municipalityCode,
      neighborhoodKey: key,
      neighborhoodLabel: label,
    };
  });

  const stateCodes = [...new Set(rows.map((r) => r.stateCode))];
  if (stateCodes.length > 0) {
    const found = conn
      .select({ c: states.ibgeCode })
      .from(states)
      .where(inArray(states.ibgeCode, stateCodes))
      .all();
    if (found.length !== stateCodes.length) throw invalid('Estado inexistente');
  }
  const muniCodes = [
    ...new Set(rows.flatMap((r) => (r.municipalityCode === null ? [] : [r.municipalityCode]))),
  ];
  if (muniCodes.length > 0) {
    const found = new Map(
      conn
        .select({ c: municipalities.ibgeCode, s: municipalities.stateCode })
        .from(municipalities)
        .where(inArray(municipalities.ibgeCode, muniCodes))
        .all()
        .map((m) => [m.c, m.s]),
    );
    for (const r of rows) {
      if (r.municipalityCode === null) continue;
      const state = found.get(r.municipalityCode);
      if (state === undefined) throw invalid('Município inexistente');
      if (state !== r.stateCode) throw invalid('Município não pertence ao estado');
    }
  }
  assertNoDuplicates(rows, regionKeyOf, 'Região duplicada');
  return rows;
}

/** Vendedores globalmente ativos (ids sem duplicata). */
function assertActiveSellers(conn: Conn, ids: number[]): void {
  if (ids.length === 0) return;
  const n = conn
    .select({ id: sellers.id })
    .from(sellers)
    .where(and(inArray(sellers.id, ids), eq(sellers.active, true)))
    .all().length;
  if (n !== ids.length) throw invalid('Vendedor inexistente ou inativo');
}

/** Vendedores ativos globalmente E com vínculo ativo com a filial (ids sem duplicata). */
export function assertSellersUsable(conn: Conn, branchId: number, sellerIds: number[]): void {
  assertActiveSellers(conn, sellerIds);
  assertSellersLinkedToBranch(conn, branchId, sellerIds);
}

/** Todo vendedor precisa de vínculo ATIVO com a filial (compatibilidade vendedor x filial). */
export function assertSellersLinkedToBranch(conn: Conn, branchId: number, sellerIds: number[]): void {
  if (sellerIds.length === 0) return;
  const n = conn
    .select({ id: sellerBranches.sellerId })
    .from(sellerBranches)
    .where(
      and(
        inArray(sellerBranches.sellerId, sellerIds),
        eq(sellerBranches.branchId, branchId),
        eq(sellerBranches.active, true),
      ),
    )
    .all().length;
  if (n !== sellerIds.length) throw invalid('Vendedor sem vínculo ativo com a filial da carteira');
}

/**
 * Troca de filial. Primeiro descarta os ajustes órfãos em relação à filial ATUAL (cliente que perdeu
 * o vínculo com ela: sem efeito e invisíveis). Depois exige que todo cliente com ajuste restante
 * tenha vínculo (ativo ou não) com a filial nova; senão lança 400 e a transação desfaz tudo,
 * inclusive a limpeza.
 */
export function replaceOverridesOnBranchChange(
  conn: Conn,
  portfolioId: number,
  currentBranchId: number,
  newBranchId: number,
): void {
  conn.run(
    sql`delete from portfolio_customer_overrides
         where portfolio_id = ${portfolioId}
           and not exists (select 1 from customer_branches cb
                            where cb.customer_id = portfolio_customer_overrides.customer_id
                              and cb.branch_id = ${currentBranchId})`,
  );
  const unlinked = conn.get<{ n: number }>(
    sql`select 1 as n from portfolio_customer_overrides ov
         where ov.portfolio_id = ${portfolioId}
           and not exists (select 1 from customer_branches cb
                            where cb.customer_id = ov.customer_id and cb.branch_id = ${newBranchId})
         limit 1`,
  );
  if (unlinked) throw invalid('Há ajustes de clientes sem vínculo com a filial da carteira');
}

function assertActiveSubgroups(conn: Conn, ids: number[]): void {
  if (ids.length === 0) return;
  const n = conn
    .select({ id: productSubgroups.id })
    .from(productSubgroups)
    .where(and(inArray(productSubgroups.id, ids), eq(productSubgroups.active, true)))
    .all().length;
  if (n !== ids.length) throw invalid('Subgrupo de produto inexistente ou inativo');
}

/** Pares (vendedor, subgrupo): sem duplicata, vendedores ativos e vinculados, subgrupos ativos. */
export function validateAssignments(
  conn: Conn,
  branchId: number,
  assignments: { sellerId: number; productSubgroupId: number }[],
): void {
  assertNoDuplicates(
    assignments,
    (a) => `${a.sellerId}:${a.productSubgroupId}`,
    'Vendedor e subgrupo duplicados',
  );
  const sellerIds = [...new Set(assignments.map((a) => a.sellerId))];
  assertSellersUsable(conn, branchId, sellerIds);
  assertActiveSubgroups(conn, [...new Set(assignments.map((a) => a.productSubgroupId))]);
}
