import { sql } from 'drizzle-orm';
import type { Conn } from '../shared/db.js';

/** Linha de vínculo a criar: [cliente, subgrupo, vendedor]. */
export type NewLinkRow = [customerId: number, subgroupId: number, sellerId: number];

/**
 * Encerra vínculos ativos por id, em lote (uma instrução por etapa, ids num único parâmetro JSON).
 * Grava um evento `ended` por vínculo (na ordem dos ids) ANTES de desativar, a partir do próprio
 * vínculo, e então marca `active = 0`, `valid_to` e `ended_by`. O vínculo nunca é apagado.
 * Chamar sempre dentro de uma transação de escrita.
 */
export function endLinks(conn: Conn, ids: number[], sub: string, at: number): void {
  if (ids.length === 0) return;
  const json = JSON.stringify(ids);
  conn.run(sql`
    insert into portfolio_link_events
      (link_id, kind, portfolio_id, branch_id, customer_id, product_subgroup_id, seller_id, occurred_at)
    select l.id, 'ended', l.portfolio_id, l.branch_id, l.customer_id, l.product_subgroup_id, l.seller_id, ${at}
    from json_each(${json}) j join portfolio_links l on l.id = j.value
    where l.active = 1
    order by j.key`);
  conn.run(sql`
    update portfolio_links set active = 0, valid_to = ${at}, ended_by = ${sub}
    where active = 1 and id in (select value from json_each(${json}))`);
}

/**
 * Cria vínculos ativos da carteira em lote e um evento `created` para cada um, na ordem de criação.
 * O índice único parcial recusa a criação se a célula já tiver vínculo ativo na filial.
 */
export function createLinks(
  conn: Conn,
  portfolio: { id: number; branchId: number },
  rows: NewLinkRow[],
  sub: string,
  at: number,
): void {
  if (rows.length === 0) return;
  // Os ids novos são todos maiores que o maior atual (escrita imediata: ninguém insere em paralelo).
  const before = conn.get<{ m: number }>(sql`select coalesce(max(id), 0) as m from portfolio_links`).m;
  conn.run(sql`
    insert into portfolio_links
      (portfolio_id, branch_id, customer_id, product_subgroup_id, seller_id, active, valid_from, valid_to, created_by, ended_by)
    select ${portfolio.id}, ${portfolio.branchId}, json_extract(value, '$[0]'), json_extract(value, '$[1]'),
      json_extract(value, '$[2]'), 1, ${at}, null, ${sub}, null
    from json_each(${JSON.stringify(rows)}) where true`);
  conn.run(sql`
    insert into portfolio_link_events
      (link_id, kind, portfolio_id, branch_id, customer_id, product_subgroup_id, seller_id, occurred_at)
    select id, 'created', portfolio_id, branch_id, customer_id, product_subgroup_id, seller_id, ${at}
    from portfolio_links where id > ${before} order by id`);
}

/**
 * Encerra TODOS os vínculos ativos da carteira, com eventos. Usada pela inativação da carteira (E3),
 * na mesma transação. Devolve quantos vínculos foram encerrados.
 */
export function endAllActiveLinks(conn: Conn, portfolioId: number, sub: string, at: number): number {
  const ids = conn
    .all<{ id: number }>(
      sql`select id from portfolio_links where portfolio_id = ${portfolioId} and active = 1 order by id`,
    )
    .map((r) => r.id);
  endLinks(conn, ids, sub, at);
  return ids.length;
}

/**
 * Encerra os vínculos ativos que casam com TODOS os filtros dados, com eventos e `ended_by`. Única porta
 * dos serviços de cadastro (E2: vendedor, cliente, filial) para encerrar vínculos fora da carteira.
 * `branchIds` vazio não casa nada; sem nenhum filtro é erro de programação (encerraria tudo).
 * Devolve quantos vínculos foram encerrados. Chamar dentro da transação de escrita do chamador.
 */
export function endLinksWhere(
  conn: Conn,
  filter: { sellerId?: number; customerId?: number; branchIds?: number[] },
  sub: string,
  at: number,
): number {
  if (filter.sellerId === undefined && filter.customerId === undefined && filter.branchIds === undefined) {
    throw new Error('endLinksWhere exige ao menos um filtro');
  }
  if (filter.branchIds?.length === 0) return 0;
  const ids = conn
    .all<{ id: number }>(
      sql`select id from portfolio_links where active = 1${
        filter.sellerId === undefined ? sql`` : sql` and seller_id = ${filter.sellerId}`
      }${filter.customerId === undefined ? sql`` : sql` and customer_id = ${filter.customerId}`}${
        filter.branchIds === undefined
          ? sql``
          : sql` and branch_id in (select value from json_each(${JSON.stringify(filter.branchIds)}))`
      } order by id`,
    )
    .map((r) => r.id);
  endLinks(conn, ids, sub, at);
  return ids.length;
}
