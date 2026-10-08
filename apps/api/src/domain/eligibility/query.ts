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

/** Posto máximo: inclusão manual vale acima de qualquer filtro. */
export const MANUAL_RANK = 6;
export type Resolution = 'assigned' | 'lost' | 'blocked';

interface Row {
  id: number;
  rank: number | null;
  by_net: number;
  by_grp: number;
  is_filter: number;
  eff_rank: number;
  cmax: number | null;
  resolution: Resolution;
}

const LEVEL_BY_RANK: Record<number, RegionLevel> = { 1: 'state', 2: 'municipality', 3: 'neighborhood' };

/**
 * Construção ÚNICA da regra de casamento, calculada por carteira: a carteira é a coluna `pf.id` (não um
 * parâmetro) e `scope` escolhe quais carteiras `pf` entram (a própria P, ou as concorrentes). O posto
 * em P e o posto nas concorrentes saem, portanto, do mesmo SQL.
 *
 * É dirigida pelos critérios: cada braço parte dos critérios da carteira e chega, por índice, aos
 * clientes que casam; só quem casou algum critério (ou tem ajuste) vira linha. Colunas: `pid`; `rank`
 * (nível de região mais específico que casou: 1 UF, 2 município, 3 bairro, NULL); `by_net`, `by_grp`;
 * `inc`/`exc` (ajuste manual); `is_filter` (casa TODOS os critérios preenchidos; carteira sem critério
 * nunca casa); `eff_rank` (posto na disputa: 6 inclusão manual; senão o maior de grupo 5, rede 4,
 * região 3/2/1 entre o que casou; NULL = não concorre, inclusive se excluído). Os critérios são lidos
 * das tabelas `portfolio_*` (sempre o estado atual) e nada é interpolado: só parâmetros.
 *
 * `validate` junta o cliente e exige cliente ativo com vínculo ativo na filial (e traz os campos de
 * busca). As concorrentes dispensam isso: só importam por meio do join com os membros de P, que já são
 * válidos na mesma filial. `customerIds` restringe a clientes específicos.
 */
function membersSql(branchId: number, scope: SQL, opts: { validate: boolean; customerIds?: number[] }): SQL {
  const ids =
    opts.customerIds === undefined
      ? undefined
      : sql.join(
          opts.customerIds.map((id) => sql`${id}`),
          sql`, `,
        );
  const onlyC = ids ? sql` and c.id in (${ids})` : sql``;
  const onlyOv = ids ? sql` and ov.customer_id in (${ids})` : sql``;
  // Braço de acertos: (carteira, cliente, nível de região, rede, grupo, inclusão, exclusão).
  const hits = (alias: string, table: string, join: SQL, lvl: number, net: number, grp: number) => sql`
        select ${sql.raw(alias)}.portfolio_id as pid, c.id as id, ${lvl} as lvl, ${net} as net, ${grp} as grp,
          0 as inc, 0 as exc
        from portfolios pf
        join ${sql.raw(table)} ${sql.raw(alias)} on ${sql.raw(alias)}.portfolio_id = pf.id
        join customers c on ${join}
        where ${scope}${onlyC}`;
  const validated = opts.validate
    ? {
        cols: sql`, c.cnpj as cnpj, c.legal_name_key as legal_name_key, c.trade_name_key as trade_name_key`,
        join: sql`join customers c on c.id = h.id`,
        where: sql`where c.active = 1
          and exists (select 1 from customer_branches cb
                       where cb.customer_id = c.id and cb.branch_id = ${branchId} and cb.active = 1)`,
      }
    : { cols: sql``, join: sql``, where: sql`` };
  return sql`
    select f.*,
      case when f.inc then ${MANUAL_RANK}
           when f.is_filter and not f.exc
             then max(case when f.by_grp then 5 else 0 end, case when f.by_net then 4 else 0 end, coalesce(f.rank, 0))
      end as eff_rank
    from (
      select b.*,
        (   (b.has_reg or b.has_net or b.has_grp)
        and (not b.has_reg or b.rank is not null)
        and (not b.has_net or b.by_net)
        and (not b.has_grp or b.by_grp)) as is_filter
      from (
        select h.pid as pid, h.id as id${validated.cols},
          h.inc as inc, h.exc as exc,
          pfx.has_reg as has_reg, pfx.has_net as has_net, pfx.has_grp as has_grp,
          nullif(h.lvl, 0) as rank, h.net as by_net, h.grp as by_grp
        from (
          select pid, id, max(lvl) as lvl, max(net) as net, max(grp) as grp, max(inc) as inc, max(exc) as exc
          from (
            ${hits('pr', 'portfolio_regions', sql`pr.level = 'neighborhood' and c.municipality_code = pr.municipality_code and c.neighborhood_key = pr.neighborhood_key`, 3, 0, 0)}
            union all
            ${hits('pr', 'portfolio_regions', sql`pr.level = 'municipality' and c.municipality_code = pr.municipality_code`, 2, 0, 0)}
            union all
            ${hits('pr', 'portfolio_regions', sql`pr.level = 'state' and c.state_code = pr.state_code`, 1, 0, 0)}
            union all
            ${hits('pn', 'portfolio_retail_networks', sql`c.retail_network_id = pn.retail_network_id`, 0, 1, 0)}
            union all
            ${hits('pg', 'portfolio_economic_groups', sql`c.economic_group_id = pg.economic_group_id`, 0, 0, 1)}
            union all
            select ov.portfolio_id, ov.customer_id, 0, 0, 0, ov.kind = 'include', ov.kind = 'exclude'
            from portfolios pf join portfolio_customer_overrides ov on ov.portfolio_id = pf.id
            where ${scope}${onlyOv}
          )
          group by pid, id
        ) h
        join (
          select pf.id as pid,
            exists (select 1 from portfolio_regions where portfolio_id = pf.id) as has_reg,
            exists (select 1 from portfolio_retail_networks where portfolio_id = pf.id) as has_net,
            exists (select 1 from portfolio_economic_groups where portfolio_id = pf.id) as has_grp
          from portfolios pf where ${scope}
        ) pfx on pfx.pid = h.pid
        ${validated.join}
        ${validated.where}
      ) b
    ) f`;
}

/** Escopo: só a carteira P. */
const ownScope = (portfolioId: number): SQL => sql`pf.id = ${portfolioId}`;
/** Escopo: concorrentes de P (mesma filial, não inativas, em rascunho ou ativas, exceto P). */
const rivalScope = (branchId: number, portfolioId: number): SQL =>
  sql`pf.branch_id = ${branchId} and pf.active = 1 and pf.id <> ${portfolioId}`;

/**
 * Prévia de P com a resolução: membros de P (`m`, validados) com o maior posto entre as concorrentes
 * (`cmax`). `assigned` sem concorrente ou posto maior; `lost` se alguma tem posto maior; `blocked` no
 * empate. P e as concorrentes saem da MESMA construção (`membersSql`), só muda o escopo; as
 * concorrentes não são validadas (só contam para quem é membro de P, que já é válido na filial).
 */
function resolvedSql(criteria: PortfolioCriteria, portfolioId: number, customerIds?: number[]): SQL {
  return sql`
    select m.*, k.cmax as cmax,
      case when k.cmax is null or m.eff_rank > k.cmax then 'assigned'
           when m.eff_rank < k.cmax then 'lost' else 'blocked' end as resolution
    from (${membersSql(criteria.branchId, ownScope(portfolioId), { validate: true, customerIds })}) m
    left join (
      select r.id as id, max(r.eff_rank) as cmax
      from (${membersSql(criteria.branchId, rivalScope(criteria.branchId, portfolioId), { validate: false, customerIds })}) r
      where r.eff_rank is not null group by r.id
    ) k on k.id = m.id
    where m.eff_rank is not null`;
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

interface Filters {
  portfolioId: number;
  q?: string | undefined;
  source?: PreviewSource | undefined;
  resolution?: Resolution | undefined;
}

/** Predicados da prévia (sem cursor): `source`, `resolution` e `q`. */
function whereSql(p: Filters): SQL {
  const parts: SQL[] = [sql`1 = 1`];
  if (p.source === 'filter') parts.push(sql`m.is_filter`);
  if (p.source === 'manual') parts.push(sql`not m.is_filter`);
  if (p.resolution) parts.push(sql`m.resolution = ${p.resolution}`);
  const search = searchClause(p.q);
  if (search) parts.push(search);
  return sql.join(parts, sql` and `);
}

/** SQL da página (exposto para `EXPLAIN QUERY PLAN`). */
export function previewPageSql(
  criteria: PortfolioCriteria,
  p: Filters & { after?: number | undefined; fetch: number },
): SQL {
  const cursor = p.after === undefined ? sql`` : sql` and m.id > ${p.after}`;
  return sql`select m.id as id, m.rank as rank, m.by_net as by_net, m.by_grp as by_grp,
      m.is_filter as is_filter, m.eff_rank as eff_rank, m.cmax as cmax, m.resolution as resolution
    from (${resolvedSql(criteria, p.portfolioId)}) m
    where ${whereSql(p)}${cursor}
    order by m.id asc limit ${p.fetch}`;
}

/**
 * Ids de TODA a prévia filtrada, em ordem (exposto para `EXPLAIN QUERY PLAN`): a disputa é calculada
 * uma única vez, e o total e a página saem daqui. Só ids trafegam (poucos bytes por cliente).
 */
export function previewIdsSql(criteria: PortfolioCriteria, p: Filters): SQL {
  return sql`select m.id as id from (${resolvedSql(criteria, p.portfolioId)}) m
    where ${whereSql(p)} order by m.id asc`;
}

/** Detalhes (posto, resolução) só dos clientes dados, pela mesma construção. */
function previewDetailSql(criteria: PortfolioCriteria, portfolioId: number, customerIds: number[]): SQL {
  return sql`select m.id as id, m.rank as rank, m.by_net as by_net, m.by_grp as by_grp,
      m.is_filter as is_filter, m.eff_rank as eff_rank, m.cmax as cmax, m.resolution as resolution
    from (${resolvedSql(criteria, portfolioId, customerIds)}) m order by m.id asc`;
}

export function previewCountSql(criteria: PortfolioCriteria, p: Filters): SQL {
  return sql`select count(*) as total from (${resolvedSql(criteria, p.portfolioId)}) m
    where ${whereSql(p)}`;
}

/** SQL das contagens de conflito de P (exposto para `EXPLAIN QUERY PLAN`). */
export function conflictCountsSql(criteria: PortfolioCriteria, portfolioId: number): SQL {
  return sql`select coalesce(sum(m.resolution = 'blocked'), 0) as blocked,
      coalesce(sum(m.resolution = 'lost'), 0) as lost
    from (${resolvedSql(criteria, portfolioId)}) m`;
}

export interface Competitor {
  portfolioId: number;
  name: string;
  rank: number;
}

export interface ResolvedItem extends PreviewItem {
  /** Posto de P para o cliente (6 = inclusão manual). */
  rank: number;
  resolution: Resolution;
  competitors: Competitor[];
}

export interface ResolvedPage {
  items: ResolvedItem[];
  nextCursor: string | null;
  total: number;
}

export interface ResolvedPageParams extends PreviewParams {
  resolution?: Resolution | undefined;
}

/** Concorrentes (com posto) de cada cliente dado, pela mesma construção SQL do posto. */
function rivalsOf(
  db: Conn,
  criteria: PortfolioCriteria,
  portfolioId: number,
  customerIds: number[],
): Map<number, Competitor[]> {
  const out = new Map<number, Competitor[]>();
  if (customerIds.length === 0) return out;
  const rows = db.all<{ id: number; pid: number; name: string; eff_rank: number }>(
    sql`select r.id as id, r.pid as pid, p.name as name, r.eff_rank as eff_rank
      from (${membersSql(criteria.branchId, rivalScope(criteria.branchId, portfolioId), { validate: false, customerIds })}) r
      join portfolios p on p.id = r.pid
      where r.eff_rank is not null
      order by r.id asc, r.eff_rank desc, r.pid asc`,
  );
  for (const r of rows) {
    const list = out.get(r.id) ?? [];
    list.push({ portfolioId: r.pid, name: r.name, rank: r.eff_rank });
    out.set(r.id, list);
  }
  return out;
}

function toItem(r: Row, competitors: Competitor[]): ResolvedItem {
  return {
    customerId: r.id,
    source: r.is_filter ? 'filter' : 'manual',
    // Inclusão manual não tem nível de região: `matchedBy` segue informativo.
    matchedRegionLevel: r.is_filter && r.rank !== null ? (LEVEL_BY_RANK[r.rank] ?? null) : null,
    matchedBy: { region: r.rank !== null, retailNetwork: !!r.by_net, economicGroup: !!r.by_grp },
    rank: r.eff_rank,
    resolution: r.resolution,
    competitors,
  };
}

/**
 * Todos os itens de P com a resolução dada, em UMA consulta (sem `competitors`, sem total): base da
 * varredura dos membros efetivos, que não pode repetir o cálculo da disputa a cada bloco.
 */
export function resolvedItems(
  db: Conn,
  criteria: PortfolioCriteria,
  portfolioId: number,
  resolution: Resolution,
): ResolvedItem[] {
  const rows = db.all<Row>(previewPageSql(criteria, { portfolioId, resolution, fetch: -1 }));
  return rows.map((r) => toItem(r, []));
}

/**
 * Página da prévia com resolução. A disputa é calculada UMA vez (só os ids, em ordem): o total é o
 * tamanho da lista e a página é a fatia depois do cursor. Os detalhes e as concorrentes vêm só dos
 * clientes da página, pela mesma construção SQL restrita a eles.
 */
export function previewPage(db: Conn, criteria: PortfolioCriteria, params: ResolvedPageParams): ResolvedPage {
  const limit = resolveLimit(params.limit);
  const after = decodeCursor(params.cursor);
  const all = db.all<{ id: number }>(previewIdsSql(criteria, params));
  // ids em ordem crescente: o primeiro depois do cursor, por busca binária.
  let start = 0;
  if (after !== undefined) {
    let hi = all.length;
    while (start < hi) {
      const mid = (start + hi) >> 1;
      if ((all[mid] as { id: number }).id <= after) start = mid + 1;
      else hi = mid;
    }
  }
  const slice = all.slice(start, start + limit + 1).map((r) => r.id);
  const ids = slice.slice(0, limit);
  const details = new Map(
    (ids.length === 0 ? [] : db.all<Row>(previewDetailSql(criteria, params.portfolioId, ids))).map((r) => [
      r.id,
      r,
    ]),
  );
  const rivals = rivalsOf(db, criteria, params.portfolioId, ids);
  const page = toPage(slice, limit, (id) => id);
  return {
    items: page.items.flatMap((id) => {
      const row = details.get(id);
      return row ? [toItem(row, rivals.get(id) ?? [])] : [];
    }),
    nextCursor: page.nextCursor,
    total: all.length,
  };
}

/** Contagens de conflito de P sobre todos os clientes com posto em P. */
export function conflictCounts(
  db: Conn,
  criteria: PortfolioCriteria,
  portfolioId: number,
): { blocked: number; lost: number } {
  return (
    db.get<{ blocked: number; lost: number }>(conflictCountsSql(criteria, portfolioId)) ?? {
      blocked: 0,
      lost: 0,
    }
  );
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
  // Membro = cliente ativo com vínculo ativo na filial (mesmo sem casar nada); `byFilter` vem da
  // construção única do motor, que só devolve linhas de quem casou algum critério.
  const list = sql.join(
    customerIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = db.all<{ id: number; is_filter: number | null }>(
    sql`select c.id as id, m.is_filter as is_filter
      from customers c
      left join (${membersSql(criteria.branchId, ownScope(portfolioId), { validate: true, customerIds })}) m on m.id = c.id
      where c.id in (${list}) and c.active = 1
        and exists (select 1 from customer_branches cb
                     where cb.customer_id = c.id and cb.branch_id = ${criteria.branchId} and cb.active = 1)`,
  );
  for (const r of rows) out.set(r.id, { member: true, byFilter: !!r.is_filter });
  return out;
}
