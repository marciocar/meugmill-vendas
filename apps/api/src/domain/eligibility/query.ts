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
 * Lista de ids como CTE `ids` com UM único parâmetro (JSON), qualquer que seja o tamanho da lista: o
 * SQLite limita a quantidade de variáveis, e a lista é usada em vários braços da consulta.
 */
function idsCte(customerIds: number[]): SQL {
  return sql`ids as (select value as id from json_each(${JSON.stringify(customerIds)}))`;
}

interface MembersOpts {
  /**
   * `customers`: parte da tabela de clientes e valida (cliente ativo com vínculo ativo na filial) já
   * DENTRO dos braços, para não varrer a UF no país e só descartar depois. `pm`: parte dos membros de P
   * (CTE `pm`, já validados na mesma filial): é a forma das concorrentes, que só importam para eles.
   */
  from: 'customers' | 'pm';
  /** Restringe a clientes da CTE `ids`. */
  onIds?: boolean;
}

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
 * Com `from: 'customers'` o resultado traz também os campos de busca e os atributos do cliente (que as
 * concorrentes usam para casar contra os membros de P).
 */
function membersSql(branchId: number, scope: SQL, opts: MembersOpts): SQL {
  const own = opts.from === 'customers';
  const source = own ? sql`customers` : sql`pm`;
  const onIds = opts.onIds ? sql` and c.id in (select id from ids)` : sql``;
  const valid = own
    ? sql` and c.active = 1
          and exists (select 1 from customer_branches cb
                       where cb.customer_id = c.id and cb.branch_id = ${branchId} and cb.active = 1)`
    : sql``;
  // Braço de acertos: (carteira, cliente, código do critério). Os códigos são bits distintos e cada
  // braço dá no máximo uma linha por (carteira, cliente) (unicidade de região, rede, grupo e ajuste),
  // então a SOMA por (carteira, cliente) equivale a um OU: 1 bairro, 2 município, 4 UF, 8 rede,
  // 16 grupo, 32 inclusão, 64 exclusão. Uma coluna só deixa o agrupamento (o trecho mais caro) barato.
  const hits = (alias: string, table: string, join: SQL, code: number) => sql`
        select ${sql.raw(alias)}.portfolio_id as pid, c.id as id, ${code} as code
        from portfolios pf
        join ${sql.raw(table)} ${sql.raw(alias)} on ${sql.raw(alias)}.portfolio_id = pf.id
        join ${source} c on ${join}
        where ${scope}${onIds}${valid}`;
  const attrs = own
    ? sql`, c.cnpj as cnpj, c.legal_name_key as legal_name_key, c.trade_name_key as trade_name_key,
        c.state_code as state_code, c.municipality_code as municipality_code,
        c.neighborhood_key as neighborhood_key, c.retail_network_id as retail_network_id,
        c.economic_group_id as economic_group_id`
    : sql``;
  const attrsJoin = own ? sql`join customers c on c.id = h.id` : sql``;
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
        with pfx as materialized (
          select pf.id as pid,
            exists (select 1 from portfolio_regions where portfolio_id = pf.id) as has_reg,
            exists (select 1 from portfolio_retail_networks where portfolio_id = pf.id) as has_net,
            exists (select 1 from portfolio_economic_groups where portfolio_id = pf.id) as has_grp
          from portfolios pf where ${scope}
        )
        select h.pid as pid, h.id as id${attrs},
          (h.code & 32) <> 0 as inc, (h.code & 64) <> 0 as exc,
          pfx.has_reg as has_reg, pfx.has_net as has_net, pfx.has_grp as has_grp,
          case when h.code & 1 then 3 when h.code & 2 then 2 when h.code & 4 then 1 end as rank,
          (h.code & 8) <> 0 as by_net, (h.code & 16) <> 0 as by_grp
        from (
          select pid, id, sum(code) as code
          from (
            ${hits('pr', 'portfolio_regions', sql`pr.level = 'neighborhood' and c.municipality_code = pr.municipality_code and c.neighborhood_key = pr.neighborhood_key`, 1)}
            union all
            ${hits('pr', 'portfolio_regions', sql`pr.level = 'municipality' and c.municipality_code = pr.municipality_code`, 2)}
            union all
            ${hits('pr', 'portfolio_regions', sql`pr.level = 'state' and c.state_code = pr.state_code`, 4)}
            union all
            ${hits('pn', 'portfolio_retail_networks', sql`c.retail_network_id = pn.retail_network_id`, 8)}
            union all
            ${hits('pg', 'portfolio_economic_groups', sql`c.economic_group_id = pg.economic_group_id`, 16)}
            union all
            select ov.portfolio_id, c.id, case ov.kind when 'include' then 32 else 64 end
            from portfolios pf
            join portfolio_customer_overrides ov on ov.portfolio_id = pf.id
            join ${source} c on c.id = ov.customer_id
            where ${scope}${onIds}${valid}
          )
          group by pid, id
        ) h
        join pfx on pfx.pid = h.pid
        ${attrsJoin}
      ) b
    ) f`;
}

/** Escopo: só a carteira P. */
const ownScope = (portfolioId: number): SQL => sql`pf.id = ${portfolioId}`;
/** Escopo: concorrentes de P (mesma filial, não inativas, em rascunho ou ativas, exceto P). */
const rivalScope = (branchId: number, portfolioId: number): SQL =>
  sql`pf.branch_id = ${branchId} and pf.active = 1 and pf.id <> ${portfolioId}`;

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

/** Predicados sobre os membros de P (sem a resolução): quem tem posto, `source` e `q`. Alias `m`. */
function memberWhere(p: Filters): SQL {
  const parts: SQL[] = [sql`m.eff_rank is not null`];
  if (p.source === 'filter') parts.push(sql`m.is_filter`);
  if (p.source === 'manual') parts.push(sql`not m.is_filter`);
  const search = searchClause(p.q);
  if (search) parts.push(search);
  return sql.join(parts, sql` and `);
}

/** Membros de P (`pm`): validados na filial, filtrados por `source` e `q`, e restritos a `customerIds`. */
function memberCtes(criteria: PortfolioCriteria, p: Filters, customerIds?: number[]): SQL {
  const onIds = customerIds !== undefined;
  return sql`${onIds ? sql`${idsCte(customerIds)},` : sql``}
    pm as materialized (
      select m.* from (${membersSql(criteria.branchId, ownScope(p.portfolioId), { from: 'customers', onIds })}) m
      where ${memberWhere(p)}
    )`;
}

/** Concorrentes de P restritas aos membros de P (`pm`): nunca calculam o conjunto inteiro da carteira. */
function rivalsSql(criteria: PortfolioCriteria, portfolioId: number): SQL {
  return membersSql(criteria.branchId, rivalScope(criteria.branchId, portfolioId), { from: 'pm' });
}

/**
 * CTEs da resolução de P: `pm` (membros) e `res`, que acrescenta a eles o maior posto entre as
 * concorrentes (`cmax`): `assigned` sem concorrente ou posto maior; `lost` se alguma tem posto maior;
 * `blocked` no empate. P e as concorrentes saem da MESMA construção (`membersSql`), só muda o escopo.
 */
function resolutionCtes(criteria: PortfolioCriteria, p: Filters, customerIds?: number[]): SQL {
  return sql`${memberCtes(criteria, p, customerIds)},
    res as (
      select m.*, k.cmax as cmax,
        case when k.cmax is null or m.eff_rank > k.cmax then 'assigned'
             when m.eff_rank < k.cmax then 'lost' else 'blocked' end as resolution
      from pm m
      left join (
        select r.id as id, max(r.eff_rank) as cmax
        from (${rivalsSql(criteria, p.portfolioId)}) r
        where r.eff_rank is not null group by r.id
      ) k on k.id = m.id
    )`;
}

const RESOLVED_COLS = sql`m.id as id, m.rank as rank, m.by_net as by_net, m.by_grp as by_grp,
      m.is_filter as is_filter, m.eff_rank as eff_rank, m.cmax as cmax, m.resolution as resolution`;

/**
 * SQL dos ids da prévia filtrada, em ordem (exposto para `EXPLAIN QUERY PLAN`). Sem `resolution` só
 * olha os membros de P (a disputa não é resolvida); com `resolution`, resolve a disputa dos membros de P.
 */
export function previewIdsSql(criteria: PortfolioCriteria, p: Filters): SQL {
  if (!p.resolution) {
    return sql`select m.id as id
      from (${membersSql(criteria.branchId, ownScope(p.portfolioId), { from: 'customers' })}) m
      where ${memberWhere(p)} order by m.id asc`;
  }
  return sql`with ${resolutionCtes(criteria, p)}
    select m.id as id from res m where m.resolution = ${p.resolution} order by m.id asc`;
}

/** SQL da página dos membros de P, sem a disputa (caminho do E4; exposto para `EXPLAIN`). */
export function previewPageSql(
  criteria: PortfolioCriteria,
  p: Filters & { after?: number | undefined; fetch: number },
): SQL {
  const cursor = p.after === undefined ? sql`` : sql` and m.id > ${p.after}`;
  return sql`select m.id as id, m.rank as rank, m.by_net as by_net, m.by_grp as by_grp,
      m.is_filter as is_filter, m.eff_rank as eff_rank
    from (${membersSql(criteria.branchId, ownScope(p.portfolioId), { from: 'customers' })}) m
    where ${memberWhere(p)}${cursor}
    order by m.id asc limit ${p.fetch}`;
}

export function previewCountSql(criteria: PortfolioCriteria, p: Filters): SQL {
  return sql`select count(*) as total
    from (${membersSql(criteria.branchId, ownScope(p.portfolioId), { from: 'customers' })}) m
    where ${memberWhere(p)}`;
}

/** Detalhes (posto, resolução) só dos clientes dados, pela mesma construção. */
function previewDetailSql(criteria: PortfolioCriteria, portfolioId: number, customerIds: number[]): SQL {
  return sql`with ${resolutionCtes(criteria, { portfolioId }, customerIds)}
    select ${RESOLVED_COLS} from res m order by m.id asc`;
}

/** SQL das contagens de conflito de P (exposto para `EXPLAIN QUERY PLAN`). */
export function conflictCountsSql(criteria: PortfolioCriteria, portfolioId: number): SQL {
  return sql`with ${resolutionCtes(criteria, { portfolioId })}
    select coalesce(sum(m.resolution = 'blocked'), 0) as blocked,
      coalesce(sum(m.resolution = 'lost'), 0) as lost
    from res m`;
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
    sql`with ${memberCtes(criteria, { portfolioId }, customerIds)}
      select r.id as id, r.pid as pid, p.name as name, r.eff_rank as eff_rank
      from (${rivalsSql(criteria, portfolioId)}) r
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
  const rows = db.all<Row>(
    sql`with ${resolutionCtes(criteria, { portfolioId })}
      select ${RESOLVED_COLS} from res m where m.resolution = ${resolution} order by m.id asc`,
  );
  return rows.map((r) => toItem(r, []));
}

/**
 * Página da prévia com resolução, numa transação de leitura (as consultas enxergam o mesmo retrato).
 * Sem o filtro `resolution` a disputa NÃO é resolvida para o conjunto: só os ids dos membros de P
 * (a página e o total saem da lista) e, depois, a resolução apenas dos clientes da página. Com o
 * filtro, resolve os membros de P (as concorrentes só calculam o posto deles) para achar o total e
 * a página. Os detalhes e as concorrentes vêm só dos clientes da página.
 */
export function previewPage(db: Conn, criteria: PortfolioCriteria, params: ResolvedPageParams): ResolvedPage {
  return db.transaction((tx) => previewPageIn(tx, criteria, params));
}

function previewPageIn(db: Conn, criteria: PortfolioCriteria, params: ResolvedPageParams): ResolvedPage {
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
 * (a regra de casamento fica num lugar só). Cliente que não é membro não aparece no mapa. A lista de
 * ids entra UMA vez, como um único parâmetro JSON (CTE `ids`), então não há teto de variáveis do SQLite.
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
  const rows = db.all<{ id: number; is_filter: number | null }>(
    sql`with ${idsCte(customerIds)}
      select c.id as id, m.is_filter as is_filter
      from ids
      join customers c on c.id = ids.id
      left join (${membersSql(criteria.branchId, ownScope(portfolioId), { from: 'customers', onIds: true })}) m on m.id = c.id
      where c.active = 1
        and exists (select 1 from customer_branches cb
                     where cb.customer_id = c.id and cb.branch_id = ${criteria.branchId} and cb.active = 1)`,
  );
  for (const r of rows) out.set(r.id, { member: true, byFilter: !!r.is_filter });
  return out;
}
