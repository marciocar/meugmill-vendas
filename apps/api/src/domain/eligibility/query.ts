import { eq, sql, type SQL } from 'drizzle-orm';
import { portfolioRegions, portfolios } from '../../db/schema.js';
import type { Conn } from '../shared/db.js';
import { notFound } from '../shared/errors.js';
import { normalizeCnpj } from '../shared/cnpj.js';
import { searchKey } from '../shared/normalize.js';
import { decodeCursor, containsPattern, resolveLimit, toPage } from '../shared/pagination.js';

export type RegionLevel = 'state' | 'municipality' | 'neighborhood';
export type PreviewSource = 'filter' | 'manual';

export interface RegionCriterion {
  level: RegionLevel;
  stateCode: number;
  municipalityCode?: number;
  neighborhoodKey?: string;
}

export interface PortfolioCriteria {
  branchId: number;
  regions: RegionCriterion[];
  retailNetworkIds: number[];
  economicGroupIds: number[];
  hasAnyCriterion: boolean;
}

export interface PreviewItem {
  customerId: number;
  source: PreviewSource;
  matchedRegionLevel: RegionLevel | null;
  matchedBy: { region: boolean; retailNetwork: boolean; economicGroup: boolean };
}

export interface PreviewPage {
  items: PreviewItem[];
  nextCursor: string | null;
  total: number;
}

export interface PreviewParams {
  portfolioId: number;
  cursor?: string | undefined;
  limit?: number | undefined;
  q?: string | undefined;
  source?: PreviewSource | undefined;
}

/** Lê o estado atual dos critérios da carteira (para exibição e para a filial). */
export function loadPortfolioCriteria(db: Conn, portfolioId: number): PortfolioCriteria {
  const portfolio = db
    .select({ branchId: portfolios.branchId })
    .from(portfolios)
    .where(eq(portfolios.id, portfolioId))
    .get();
  if (!portfolio) throw notFound();
  const regions = db
    .select()
    .from(portfolioRegions)
    .where(eq(portfolioRegions.portfolioId, portfolioId))
    .orderBy(portfolioRegions.id)
    .all();
  const networks = db.all<{ id: number }>(
    sql`select retail_network_id as id from portfolio_retail_networks where portfolio_id = ${portfolioId}`,
  );
  const groups = db.all<{ id: number }>(
    sql`select economic_group_id as id from portfolio_economic_groups where portfolio_id = ${portfolioId}`,
  );
  return {
    branchId: portfolio.branchId,
    regions: regions.map((r) => ({
      level: r.level,
      stateCode: r.stateCode,
      ...(r.municipalityCode === null ? {} : { municipalityCode: r.municipalityCode }),
      ...(r.neighborhoodKey === null ? {} : { neighborhoodKey: r.neighborhoodKey }),
    })),
    retailNetworkIds: networks.map((n) => n.id),
    economicGroupIds: groups.map((g) => g.id),
    hasAnyCriterion: regions.length + networks.length + groups.length > 0,
  };
}

interface Row {
  id: number;
  rank: number | null;
  by_net: number;
  by_grp: number;
  is_filter: number;
}

const LEVEL_BY_RANK: Record<number, RegionLevel> = { 1: 'state', 2: 'municipality', 3: 'neighborhood' };

/**
 * Tabela virtual `m` (um registro por cliente da filial, ativo e com vínculo ativo) com:
 * `rank` (nível mais específico que casou: 1 UF, 2 município, 3 bairro, NULL), `by_net`, `by_grp`,
 * `kind` (ajuste manual) e `is_filter` (casa todos os critérios preenchidos; carteira sem critério
 * nunca casa). Os critérios vêm por subconsulta nas tabelas `portfolio_*`: o motor lê sempre o estado
 * atual da carteira e nada é interpolado (só parâmetros).
 */
function membersSql(branchId: number, portfolioId: number): SQL {
  return sql`
    select b.*,
      (   (b.has_reg or b.has_net or b.has_grp)
      and (not b.has_reg or b.rank is not null)
      and (not b.has_net or b.by_net)
      and (not b.has_grp or b.by_grp)) as is_filter
    from (
      select c.id as id, c.cnpj as cnpj, c.legal_name_key as legal_name_key, c.trade_name_key as trade_name_key,
        ov.kind as kind,
        exists (select 1 from portfolio_regions where portfolio_id = ${portfolioId}) as has_reg,
        exists (select 1 from portfolio_retail_networks where portfolio_id = ${portfolioId}) as has_net,
        exists (select 1 from portfolio_economic_groups where portfolio_id = ${portfolioId}) as has_grp,
        (select max(case pr.level when 'neighborhood' then 3 when 'municipality' then 2 else 1 end)
           from portfolio_regions pr
          where pr.portfolio_id = ${portfolioId}
            and ((pr.level = 'state' and pr.state_code = c.state_code)
              or (pr.level = 'municipality' and pr.municipality_code = c.municipality_code)
              or (pr.level = 'neighborhood' and pr.municipality_code = c.municipality_code
                  and pr.neighborhood_key = c.neighborhood_key))) as rank,
        coalesce(c.retail_network_id in (
          select retail_network_id from portfolio_retail_networks where portfolio_id = ${portfolioId}), 0) as by_net,
        coalesce(c.economic_group_id in (
          select economic_group_id from portfolio_economic_groups where portfolio_id = ${portfolioId}), 0) as by_grp
      from customers c
      left join portfolio_customer_overrides ov on ov.portfolio_id = ${portfolioId} and ov.customer_id = c.id
      where c.active = 1
        and exists (select 1 from customer_branches cb
                     where cb.customer_id = c.id and cb.branch_id = ${branchId} and cb.active = 1)
    ) b`;
}

function searchClause(q: string | undefined): SQL | undefined {
  const text = q?.trim();
  if (!text) return undefined;
  const byKey = sql`like ${containsPattern(searchKey(text))} escape '\\'`;
  const digits = normalizeCnpj(text);
  return sql`(m.legal_name_key ${byKey} or m.trade_name_key ${byKey}${
    digits ? sql` or m.cnpj like ${containsPattern(digits)} escape '\\'` : sql``
  })`;
}

/** Predicados da prévia (sem cursor): (filtro − exclusões) ∪ inclusões, com `q` e `source`. */
function whereSql(q: string | undefined, source: PreviewSource | undefined): SQL {
  const parts: SQL[] = [sql`((m.is_filter and m.kind is not 'exclude') or m.kind = 'include')`];
  if (source === 'filter') parts.push(sql`m.is_filter`);
  if (source === 'manual') parts.push(sql`not m.is_filter`);
  const search = searchClause(q);
  if (search) parts.push(search);
  return sql.join(parts, sql` and `);
}

/** SQL da página (exposto para `EXPLAIN QUERY PLAN`). */
export function previewPageSql(
  criteria: PortfolioCriteria,
  p: {
    portfolioId: number;
    after?: number | undefined;
    fetch: number;
    q?: string | undefined;
    source?: PreviewSource | undefined;
  },
): SQL {
  const cursor = p.after === undefined ? sql`` : sql` and m.id > ${p.after}`;
  return sql`select m.id as id, m.rank as rank, m.by_net as by_net, m.by_grp as by_grp, m.is_filter as is_filter
    from (${membersSql(criteria.branchId, p.portfolioId)}) m
    where ${whereSql(p.q, p.source)}${cursor}
    order by m.id asc limit ${p.fetch}`;
}

export function previewCountSql(
  criteria: PortfolioCriteria,
  p: { portfolioId: number; q?: string | undefined; source?: PreviewSource | undefined },
): SQL {
  return sql`select count(*) as total from (${membersSql(criteria.branchId, p.portfolioId)}) m
    where ${whereSql(p.q, p.source)}`;
}

/** Página da prévia de elegibilidade: uma consulta para a página e outra para o total. */
export function previewPage(db: Conn, criteria: PortfolioCriteria, params: PreviewParams): PreviewPage {
  const limit = resolveLimit(params.limit);
  const after = decodeCursor(params.cursor);
  const common = { portfolioId: params.portfolioId, q: params.q, source: params.source };
  const rows = db.all<Row>(previewPageSql(criteria, { ...common, after, fetch: limit + 1 }));
  const total = db.get<{ total: number }>(previewCountSql(criteria, common))?.total ?? 0;
  const page = toPage(rows, limit, (r) => r.id);
  return {
    items: page.items.map((r) => ({
      customerId: r.id,
      source: r.is_filter ? 'filter' : 'manual',
      matchedRegionLevel: r.rank === null ? null : (LEVEL_BY_RANK[r.rank] ?? null),
      matchedBy: { region: r.rank !== null, retailNetwork: !!r.by_net, economicGroup: !!r.by_grp },
    })),
    nextCursor: page.nextCursor,
    total,
  };
}

export interface EligibilityState {
  /** Cliente ativo com vínculo ativo na filial da carteira (pode entrar na prévia). */
  member: boolean;
  /** Casa os filtros da carteira hoje (candidato por filtro). */
  byFilter: boolean;
}

/**
 * Situação de elegibilidade de clientes específicos, pela mesma tabela virtual do motor
 * (a regra de casamento fica num lugar só). Cliente que não é membro não aparece no mapa.
 */
export function eligibilityOf(
  db: Conn,
  criteria: PortfolioCriteria,
  portfolioId: number,
  customerIds: number[],
): Map<number, EligibilityState> {
  const out = new Map<number, EligibilityState>();
  if (customerIds.length === 0) return out;
  const list = sql.join(
    customerIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = db.all<{ id: number; is_filter: number }>(
    sql`select m.id as id, m.is_filter as is_filter
      from (${membersSql(criteria.branchId, portfolioId)}) m where m.id in (${list})`,
  );
  for (const r of rows) out.set(r.id, { member: true, byFilter: !!r.is_filter });
  return out;
}
