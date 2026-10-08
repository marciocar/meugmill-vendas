import { and, eq } from 'drizzle-orm';
import {
  economicGroups,
  portfolioTypes,
  portfolios,
  productSubgroups,
  retailNetworks,
  sellers,
} from '../../../db/schema.js';
import { findMunicipality, findStateByUf } from '../../geo/repository.js';
import { portfolioNameKey } from '../../portfolios/name-key.js';
import type { PortfolioResponse, RegionInput } from '../../portfolios/schemas.js';
import type { Conn } from '../../shared/db.js';
import { invalid } from '../../shared/errors.js';
import { neighborhoodKey } from '../../shared/normalize.js';
import { cleanOptionalText } from '../../shared/validate.js';
import { splitList } from '../codec.js';
import type { Row } from '../layouts.js';
import {
  active,
  assertUnchangedSinceValidation,
  branchIdByCode,
  clean,
  code,
  codeList,
  ok,
  required,
  sameSet,
  single,
} from './common.js';
import type { Activation, Importer, RowResult } from './types.js';

type CodeTable =
  | typeof portfolioTypes
  | typeof retailNetworks
  | typeof economicGroups
  | typeof productSubgroups
  | typeof sellers;

function idsByCode(conn: Conn, table: CodeTable, codes: string[], column: string): number[] {
  return codes.map((c) => {
    const row = conn.select({ id: table.id }).from(table).where(eq(table.code, c)).get();
    if (!row) throw invalid(`Código não encontrado: ${column}`);
    return row.id;
  });
}

/** Carteira pela chave natural (filial + nome normalizado), ativa ou não. */
export function findPortfolio(conn: Conn, branchId: number, name: string) {
  return (
    conn
      .select({ id: portfolios.id, version: portfolios.version })
      .from(portfolios)
      .where(and(eq(portfolios.branchId, branchId), eq(portfolios.nameKey, portfolioNameKey(name))))
      .get() ?? null
  );
}

/** Chave natural da carteira no arquivo: filial + nome normalizado. */
export function portfolioKey(branchCode: string, name: string): string | null {
  const key = portfolioNameKey(name);
  return branchCode === '' || key === '' ? null : `${branchCode}\u0000${key}`;
}

/** `UF`, `UF/município` ou `UF/município/bairro` (o bairro é o resto, pode ter `/`). */
function parseRegion(conn: Conn, item: string): RegionInput {
  const [uf = '', mun, ...rest] = item.split('/').map((p) => p.trim());
  const state = findStateByUf(conn, uf.toUpperCase());
  if (!state) throw invalid('Campo inválido: regioes');
  if (mun === undefined) return { level: 'state', stateCode: state.ibgeCode };
  if (!/^\d{1,9}$/.test(mun)) throw invalid('Campo inválido: regioes');
  const municipality = findMunicipality(conn, Number(mun));
  if (!municipality || municipality.stateCode !== state.ibgeCode) throw invalid('Campo inválido: regioes');
  if (rest.length === 0) {
    return { level: 'municipality', stateCode: state.ibgeCode, municipalityCode: municipality.ibgeCode };
  }
  return {
    level: 'neighborhood',
    stateCode: state.ibgeCode,
    municipalityCode: municipality.ibgeCode,
    neighborhoodLabel: rest.join('/'),
  };
}

/** Chave canônica de região, igual para a entrada e para o agregado gravado. */
function regionKey(r: {
  level: string;
  stateCode: number;
  municipalityCode?: number | undefined;
  neighborhoodKey?: string | undefined;
}): string {
  return `${r.level}:${r.stateCode}:${r.municipalityCode ?? 0}:${r.neighborhoodKey ?? ''}`;
}

function inputRegionKey(r: RegionInput): string {
  return regionKey({
    level: r.level,
    stateCode: r.stateCode,
    municipalityCode: r.municipalityCode,
    neighborhoodKey: r.neighborhoodLabel === undefined ? undefined : neighborhoodKey(r.neighborhoodLabel),
  });
}

/** Pares `subgrupo:vendedor` (códigos). */
function parseSellerPairs(conn: Conn, row: Row): { sellerId: number; productSubgroupId: number }[] {
  const items = splitList(row.get('vendedores'));
  if (new Set(items).size !== items.length) throw invalid('Item repetido: vendedores');
  return items.map((item) => {
    const m = /^([^:\s]+):([^:\s]+)$/.exec(item);
    if (!m) throw invalid('Campo inválido: vendedores');
    const [productSubgroupId] = idsByCode(conn, productSubgroups, [m[1] as string], 'vendedores');
    const [sellerId] = idsByCode(conn, sellers, [m[2] as string], 'vendedores');
    return { sellerId: sellerId as number, productSubgroupId: productSubgroupId as number };
  });
}

const pairKey = (p: { sellerId: number; productSubgroupId: number }) =>
  `${p.productSubgroupId}:${p.sellerId}`;

/**
 * Carteiras: cabeçalho (filial + nome como chave; tipo, responsável, descrição) e filtros/vendedores.
 * Cada seção é trocada só quando difere. A carteira inativa é reativada antes de editar (ou a edição
 * falha com a regra do E3); a inativação vem por último.
 */
export const portfolioImporter: Importer = {
  keyOf: (row) => portfolioKey(row.get('filial_codigo'), row.get('nome')),
  apply(ctx, unit) {
    const row = unit.rows[0] as Row;
    return single(row, (): RowResult => {
      const svc = ctx.services.portfolios;
      const branchId = branchIdByCode(ctx.db, code(row, 'filial_codigo'), 'filial_codigo');
      const name = clean(required(row, 'nome'));
      const [portfolioTypeId] = idsByCode(ctx.db, portfolioTypes, [code(row, 'tipo_codigo')], 'tipo_codigo');
      const responsibleSub = required(row, 'responsavel_sub');
      const description = cleanOptionalText(row.get('descricao'));
      const regions = splitList(row.get('regioes')).map((r) => parseRegion(ctx.db, r));
      const retailNetworkIds = idsByCode(
        ctx.db,
        retailNetworks,
        codeList(row, 'redes', { required: false }),
        'redes',
      );
      const economicGroupIds = idsByCode(
        ctx.db,
        economicGroups,
        codeList(row, 'grupos_economicos', { required: false }),
        'grupos_economicos',
      );
      const assignments = parseSellerPairs(ctx.db, row);
      const wantActive = active(row);
      const found = findPortfolio(ctx.db, branchId, name);
      assertUnchangedSinceValidation(ctx, row.line, found);

      const filters = { regions, retailNetworkIds, economicGroupIds };
      const hasFilters = regions.length + retailNetworkIds.length + economicGroupIds.length > 0;

      if (!found) {
        let p: PortfolioResponse = svc.create(ctx.actor, {
          name,
          description,
          branchId,
          responsibleSub,
          portfolioTypeId: portfolioTypeId as number,
        });
        if (hasFilters) p = svc.replaceFilters(ctx.actor, p.id, p.version, filters);
        if (assignments.length > 0) p = svc.replaceSellers(ctx.actor, p.id, p.version, { assignments });
        if (!wantActive) svc.deactivate(ctx.actor, p.id, p.version);
        return ok('create', null, wantActive ? null : 'deactivate');
      }

      let p = svc.get(ctx.actor, found.id);
      let activation: Activation | null = null;
      if (wantActive && !p.active) {
        p = svc.reactivate(ctx.actor, p.id, p.version);
        activation = 'reactivate';
      }
      const header = {
        ...(p.name !== name ? { name } : {}),
        ...(p.description !== description ? { description } : {}),
        ...(p.responsibleSub !== responsibleSub ? { responsibleSub } : {}),
        ...(p.type.id !== portfolioTypeId ? { portfolioTypeId: portfolioTypeId as number } : {}),
      };
      const filtersChanged =
        !sameSet(
          p.filters.regions.map((r) => regionKey(r)),
          regions.map(inputRegionKey),
        ) ||
        !sameSet(
          p.filters.retailNetworks.map((n) => n.id),
          retailNetworkIds,
        ) ||
        !sameSet(
          p.filters.economicGroups.map((g) => g.id),
          economicGroupIds,
        );
      const sellersChanged = !sameSet(
        p.sellers.map((s) => pairKey({ sellerId: s.seller.id, productSubgroupId: s.productSubgroup.id })),
        assignments.map(pairKey),
      );
      if (Object.keys(header).length > 0) p = svc.update(ctx.actor, p.id, p.version, header);
      if (filtersChanged) p = svc.replaceFilters(ctx.actor, p.id, p.version, filters);
      if (sellersChanged) p = svc.replaceSellers(ctx.actor, p.id, p.version, { assignments });
      if (!wantActive && p.active) {
        svc.deactivate(ctx.actor, p.id, p.version);
        activation = 'deactivate';
      }
      const changed = Object.keys(header).length > 0 || filtersChanged || sellersChanged;
      return ok(changed ? 'update' : 'unchanged', found, activation);
    });
  },
};
