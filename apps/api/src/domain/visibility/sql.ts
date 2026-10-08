import { sql, type SQL } from 'drizzle-orm';
import { portfolios } from '../../db/schema.js';
import type { Actor } from '../shared/authz.js';
import { hasProfile, PROFILE, type Profile } from './profiles.js';

/** Quem justifica o vínculo em `via`: um perfil, ou `legacy` (sem perfil conhecido). */
export type ViaProfile = Profile | 'legacy';

/**
 * Uma fonte de visibilidade do ator. `customers` devolve os ids (coluna `customer_id`); `links` devolve
 * as linhas (customer_id, product_subgroup_id, portfolio_id, profile) que explicam a visibilidade.
 * `among` restringe a ids de cliente (lista em JSON, via `json_each`), para checagem em lote.
 */
export interface VisibleSource {
  profile: ViaProfile;
  customers(among?: number[]): SQL;
  links(among?: number[]): SQL;
}

/** Filiais do token (códigos em `branches.code`) como subconsulta de ids. Sem códigos, vazia. */
function scopeSql(actor: Actor): SQL {
  const codes = JSON.stringify([...new Set(actor.branchCodes)]);
  return sql`(select b.id from branches b where b.code in (select value from json_each(${codes})))`;
}

function amongSql(column: string, among: number[] | undefined): SQL {
  if (among === undefined) return sql``;
  return sql` and ${sql.raw(column)} in (select value from json_each(${JSON.stringify(among)}))`;
}

/** Perfil que rotula a leitura ampla (admin > supervisão > legacy). */
function broadProfile(actor: Actor): ViaProfile {
  if (hasProfile(actor, PROFILE.admin)) return PROFILE.admin;
  if (hasProfile(actor, PROFILE.supervision)) return PROFILE.supervision;
  return 'legacy';
}

/** Leitura ampla: todos os clientes ligados (ativo) às filiais do token. */
function broadSource(actor: Actor): VisibleSource {
  const profile = broadProfile(actor);
  return {
    profile,
    customers: (among) =>
      sql`select distinct cb.customer_id as customer_id from customer_branches cb
        where cb.active = 1 and cb.branch_id in ${scopeSql(actor)}${amongSql('cb.customer_id', among)}`,
    links: (among) =>
      sql`select l.customer_id as customer_id, l.product_subgroup_id as product_subgroup_id,
          l.portfolio_id as portfolio_id, ${profile} as profile
        from portfolio_links l
        where l.active = 1 and l.branch_id in ${scopeSql(actor)}${amongSql('l.customer_id', among)}`,
  };
}

/**
 * Fonte por vínculo ativo (E7). Aqui fica a regra de cada perfil:
 * - gestor: carteiras em que o ator é o responsável;
 * - vendedor: vínculos do vendedor cujo `user_sub` é o `sub` do ator (sem ligação, nada).
 */
function linkSource(profile: 'gestor' | 'vendedor', actor: Actor): VisibleSource {
  const owner =
    profile === PROFILE.manager
      ? sql`join portfolios p on p.id = l.portfolio_id where p.responsible_sub = ${actor.sub}`
      : sql`join sellers s on s.id = l.seller_id where s.user_sub = ${actor.sub}`;
  const body = (among: number[] | undefined) =>
    sql`from portfolio_links l ${owner} and l.active = 1 and l.branch_id in ${scopeSql(actor)}${amongSql('l.customer_id', among)}`;
  return {
    profile,
    customers: (among) => sql`select distinct l.customer_id as customer_id ${body(among)}`,
    links: (among) =>
      sql`select l.customer_id as customer_id, l.product_subgroup_id as product_subgroup_id,
        l.portfolio_id as portfolio_id, ${profile} as profile ${body(among)}`,
  };
}

/** Fontes do ator: leitura ampla (admin, supervisão ou legacy) uma só vez, mais gestor e vendedor. */
export function visibleSources(actor: Actor, broad: boolean): VisibleSource[] {
  const out: VisibleSource[] = [];
  if (broad) out.push(broadSource(actor));
  if (hasProfile(actor, PROFILE.manager)) out.push(linkSource(PROFILE.manager, actor));
  if (hasProfile(actor, PROFILE.seller)) out.push(linkSource(PROFILE.seller, actor));
  return out;
}

/** Sem nenhuma fonte, a seleção é vazia. */
const NOTHING = sql`select null as customer_id where 0`;

/**
 * Clientes visíveis ao ator: união (sem repetir) das fontes dos seus perfis, sempre limitada às filiais
 * do token. Devolve um SELECT de `customer_id`; use como `x in (select customer_id from (…))` ou como CTE.
 * `broad` diz se o ator tem leitura ampla (decidido por `canReadBroadly`, que também trata o `legacy`).
 */
export function visibleCustomersSql(actor: Actor, broad: boolean, among?: number[]): SQL {
  const sources = visibleSources(actor, broad);
  if (sources.length === 0) return NOTHING;
  return sql.join(
    sources.map((s) => s.customers(among)),
    sql` union `,
  );
}

/**
 * Condição de leitura de uma carteira para quem NÃO tem leitura ampla (referencia `portfolios`):
 * o responsável, ou o vendedor ligado ao login que atua nela (`portfolio_sellers`) ou tem vínculo ativo.
 */
export function portfolioReadableSql(actor: Actor): SQL {
  const seller = hasProfile(actor, PROFILE.seller)
    ? sql` or exists (select 1 from sellers s where s.user_sub = ${actor.sub} and (
        exists (select 1 from portfolio_sellers ps where ps.portfolio_id = ${portfolios.id} and ps.seller_id = s.id)
        or exists (select 1 from portfolio_links l where l.portfolio_id = ${portfolios.id} and l.active = 1 and l.seller_id = s.id)))`
    : sql``;
  return sql`(${portfolios.responsibleSub} = ${actor.sub}${seller})`;
}
