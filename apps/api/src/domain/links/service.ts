import { sql } from 'drizzle-orm';
import { loadAssignmentGrid } from '../distribution/grid.js';
import { conflictTotals, effectiveMembers } from '../conflicts/members.js';
import { bump, findReadable, openForEdit } from '../portfolios/access.js';
import { loadAggregateBase } from '../portfolios/aggregate.js';
import { resolveScopeIds, type Actor } from '../shared/authz.js';
import { writeTx, type Conn, type Db, type ServiceOptions } from '../shared/db.js';
import { DomainError, forbidden, invalid, notFound } from '../shared/errors.js';
import { decodeCursor, encodeCursor, resolveLimit } from '../shared/pagination.js';
import { canReadBroadly } from '../visibility/profiles.js';
import { parseInput } from '../shared/validate.js';
import {
  DEFAULT_EVENTS_LIMIT,
  LinkEventsQuerySchema,
  LinkHistoryQuerySchema,
  LinkListQuerySchema,
  type FinalizeResult,
  type LinkEventItem,
  type LinkEventPage,
  type LinkEventsParams,
  type LinkHistoryPage,
  type LinkHistoryParams,
  type LinkItem,
  type LinkListParams,
  type LinkPage,
} from './schemas.js';
import { createLinks, endLinks, type NewLinkRow } from './write.js';

export interface LinkService {
  /**
   * Finaliza a carteira: grava os vínculos a partir da grade de atribuições (E6) e muda o status para
   * `active`. Mesma permissão, versão e regra de inativa da edição do E3. Erros de regra:
   * `portfolio_has_conflicts` (clientes bloqueados), `portfolio_incomplete` (células sem vendedor válido),
   * `validation_error` (filial da carteira inativa) e `link_conflict` (só fail-closed: outra carteira da
   * filial mantém vínculo ativo num cliente que ela ainda vence; não deve ocorrer).
   *
   * Cliente que esta carteira venceu (`assigned`) é `lost` nas outras da filial: o vínculo ativo da outra
   * carteira naquela célula é encerrado aqui (evento `ended`, `ended_by` = ator, versão da outra +1) e
   * contado em `takenOver`. A carteira vazia (sem nenhum cliente) é finalizável: vira `active` sem vínculos.
   *
   * Sem nenhuma mudança nos vínculos e com a carteira já `active`, nada é gravado: a versão e o ETag não
   * mudam e o resultado é `{ created: 0, ended: 0, kept }`.
   */
  finalize(actor: Actor, portfolioId: number, expectedVersion: number | undefined): FinalizeResult;
  /** Vínculos ATIVOS da carteira, por id. Leitura com o escopo de filial da carteira. */
  listLinks(actor: Actor, portfolioId: number, params?: LinkListParams): LinkPage;
  /** Todos os vínculos da carteira (ativos e encerrados), por id; filtro opcional por cliente. */
  listLinkHistory(actor: Actor, portfolioId: number, params?: LinkHistoryParams): LinkHistoryPage;
  /**
   * Outbox: eventos de vínculo das filiais do token, por id, com cursor `after` (último id visto).
   * `branchId` fora do escopo é `not_found`.
   */
  listLinkEvents(actor: Actor, params?: LinkEventsParams): LinkEventPage;
}

interface ActiveLink {
  id: number;
  b: number;
  c: number;
  g: number;
  s: number;
}

const keyOf = (c: number, g: number): string => `${c}.${g}`;

interface TakenLink {
  linkId: number;
  portfolioId: number;
  customerId: number;
}

/** Vínculos ativos de outras carteiras da filial nas células a criar (índice único parcial por célula). */
function linksInCells(conn: Conn, branchId: number, portfolioId: number, rows: NewLinkRow[]): TakenLink[] {
  if (rows.length === 0) return [];
  // CROSS JOIN fixa a ordem: percorre as linhas a criar e sonda o índice único parcial por célula
  // (sem isso o planejador pode varrer os vínculos ativos da filial para cada linha).
  return conn.all<TakenLink>(
    sql`with cells as materialized (
        select json_extract(value, '$[0]') as c, json_extract(value, '$[1]') as g from json_each(${JSON.stringify(rows)})
      )
      select l.id as linkId, l.portfolio_id as portfolioId, l.customer_id as customerId
      from cells cross join portfolio_links l
        on l.branch_id = ${branchId} and l.customer_id = cells.c and l.product_subgroup_id = cells.g and l.active = 1
      where l.portfolio_id <> ${portfolioId}
      order by l.id`,
  );
}

/**
 * Carteiras em que ALGUM dos clientes ainda é `assigned` (não deveria ocorrer: o cliente é `assigned` na
 * carteira que finaliza). Rede de segurança fail-closed contra encerrar vínculo de quem ainda vence.
 */
function stillWinning(conn: Conn, taken: TakenLink[]): number[] {
  const byPortfolio = new Map<number, Set<number>>();
  for (const t of taken) {
    const set = byPortfolio.get(t.portfolioId) ?? new Set<number>();
    set.add(t.customerId);
    byPortfolio.set(t.portfolioId, set);
  }
  const out: number[] = [];
  for (const [id, customers] of [...byPortfolio].sort((a, b) => a[0] - b[0])) {
    for (const m of effectiveMembers(conn, id)) {
      if (customers.has(m.customerId)) {
        out.push(id);
        break;
      }
    }
  }
  return out;
}

interface LinkRowRaw {
  id: number;
  active: number;
  validFrom: number;
  validTo: number | null;
  cId: number;
  cnpj: string;
  legalName: string;
  gId: number;
  gCode: string;
  gName: string;
  sId: number;
  sCode: string;
  sName: string;
}

const LINK_SELECT = sql`
  select l.id as id, l.active as active, l.valid_from as validFrom, l.valid_to as validTo,
    c.id as cId, c.cnpj as cnpj, c.legal_name as legalName,
    g.id as gId, g.code as gCode, g.name as gName,
    s.id as sId, s.code as sCode, s.name as sName
  from portfolio_links l
  join customers c on c.id = l.customer_id
  join product_subgroups g on g.id = l.product_subgroup_id
  join sellers s on s.id = l.seller_id`;

const toItem = (r: LinkRowRaw): LinkItem => ({
  id: r.id,
  customer: { id: r.cId, cnpj: r.cnpj, legalName: r.legalName },
  productSubgroup: { id: r.gId, code: r.gCode, name: r.gName },
  seller: { id: r.sId, code: r.sCode, name: r.sName },
  active: r.active === 1,
  validFrom: r.validFrom,
  validTo: r.validTo,
});

function pageOf(rows: LinkRowRaw[], limit: number): { items: LinkItem[]; nextCursor: string | null } {
  const slice = rows.slice(0, limit);
  const last = slice[slice.length - 1];
  return {
    items: slice.map(toItem),
    nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null,
  };
}

export function createLinkService(db: Db, opts: ServiceOptions = {}): LinkService {
  const now = opts.now ?? Date.now;

  return {
    finalize(actor, portfolioId, expectedVersion) {
      return writeTx(db, (tx) => {
        const row = openForEdit(tx, actor, portfolioId, expectedVersion);

        // Filial inativa não finaliza (os vínculos seriam criados numa filial desativada).
        const branchActive = tx.get<{ active: number }>(
          sql`select active from branches where id = ${row.branchId}`,
        ).active;
        if (branchActive !== 1) throw invalid('Filial da carteira inativa: não é possível finalizar');

        // Retrato único: a grade e a escrita dos vínculos na mesma transação imediata.
        const blocked = conflictTotals(tx, portfolioId).blocked;
        if (blocked > 0) {
          throw new DomainError(
            'portfolio_has_conflicts',
            'A carteira tem clientes em conflito com outra carteira da filial',
            { blocked },
          );
        }

        const desired = new Map<string, NewLinkRow>();
        let unassigned = 0;
        let stale = 0;
        for (const cell of loadAssignmentGrid(tx, portfolioId)) {
          // Atribuição gravada fora da grade (cliente que saiu, subgrupo removido) não gera vínculo
          // nem impede a finalização: não é célula da grade.
          if (!cell.inGrid) continue;
          if (cell.status === 'assigned') {
            desired.set(keyOf(cell.customerId, cell.subgroupId), [
              cell.customerId,
              cell.subgroupId,
              cell.sellerId as number,
            ]);
          } else if (cell.status === 'unassigned') unassigned++;
          else stale++;
        }
        if (unassigned + stale > 0) {
          throw new DomainError('portfolio_incomplete', 'Há células da grade sem vendedor válido atribuído', {
            unassigned,
            stale,
          });
        }

        // Diff contra os vínculos ativos de P.
        const toEnd: number[] = [];
        const toCreate: NewLinkRow[] = [];
        const matched = new Set<string>();
        let kept = 0;
        const active = tx.all<ActiveLink>(
          sql`select id, branch_id as b, customer_id as c, product_subgroup_id as g, seller_id as s
            from portfolio_links where portfolio_id = ${portfolioId} and active = 1 order by id`,
        );
        for (const l of active) {
          const key = keyOf(l.c, l.g);
          const want = desired.get(key);
          // Defesa em profundidade: vínculo de outra filial (carteira transferida) nunca é mantido.
          if (want && want[2] === l.s && l.b === row.branchId) {
            kept++;
            matched.add(key);
          } else toEnd.push(l.id); // saiu da grade ou trocou de vendedor (o novo é criado abaixo)
        }
        for (const [key, want] of desired) if (!matched.has(key)) toCreate.push(want);

        const at = now();
        if (toEnd.length === 0 && toCreate.length === 0 && row.status === 'active') {
          return { aggregate: loadAggregateBase(tx, portfolioId), created: 0, ended: 0, kept, takenOver: 0 };
        }

        // Células a criar em que outra carteira da filial ainda mantém vínculo ativo: o cliente é `assigned`
        // aqui (regra do E5) e portanto `lost` lá, então o vínculo de lá é encerrado e a versão dela sobe.
        const taken = linksInCells(tx, row.branchId, portfolioId, toCreate);
        const still = stillWinning(tx, taken);
        if (still.length > 0) {
          throw new DomainError(
            'link_conflict',
            'Outra carteira da filial mantém vínculo ativo em clientes desta carteira: finalize-a novamente',
            { portfolioIds: still },
          );
        }
        const takenPortfolios = [...new Set(taken.map((t) => t.portfolioId))];

        // Encerrar antes de criar: o índice único parcial só admite um ativo por célula.
        endLinks(tx, [...toEnd, ...taken.map((t) => t.linkId)], actor.sub, at);
        for (const id of takenPortfolios) {
          tx.run(
            sql`update portfolios set version = version + 1, updated_at = ${at}, updated_by = ${actor.sub} where id = ${id}`,
          );
        }
        createLinks(tx, row, toCreate, actor.sub, at);
        bump(tx, row, actor, at, { status: 'active', finalizedAt: at, finalizedBy: actor.sub });
        return {
          aggregate: loadAggregateBase(tx, portfolioId),
          created: toCreate.length,
          ended: toEnd.length,
          kept,
          takenOver: taken.length,
        };
      });
    },

    listLinks(actor, portfolioId, params = {}) {
      const p = parseInput(LinkListQuerySchema, params);
      const limit = resolveLimit(p.limit);
      const after = decodeCursor(p.cursor);
      return db.transaction((tx) => {
        findReadable(tx, actor, portfolioId, opts);
        const filters = sql`${p.productSubgroupId === undefined ? sql`` : sql` and l.product_subgroup_id = ${p.productSubgroupId}`}${
          p.sellerId === undefined ? sql`` : sql` and l.seller_id = ${p.sellerId}`
        }`;
        const total = tx.get<{ n: number }>(
          sql`select count(*) as n from portfolio_links l where l.portfolio_id = ${portfolioId} and l.active = 1${filters}`,
        ).n;
        const rows = tx.all<LinkRowRaw>(
          sql`${LINK_SELECT} where l.portfolio_id = ${portfolioId} and l.active = 1${filters}${
            after === undefined ? sql`` : sql` and l.id > ${after}`
          } order by l.id limit ${limit + 1}`,
        );
        return { ...pageOf(rows, limit), total };
      });
    },

    listLinkHistory(actor, portfolioId, params = {}) {
      const p = parseInput(LinkHistoryQuerySchema, params);
      const limit = resolveLimit(p.limit);
      const after = decodeCursor(p.cursor);
      return db.transaction((tx) => {
        findReadable(tx, actor, portfolioId, opts);
        const rows = tx.all<LinkRowRaw>(
          sql`${LINK_SELECT} where l.portfolio_id = ${portfolioId}${
            p.customerId === undefined ? sql`` : sql` and l.customer_id = ${p.customerId}`
          }${after === undefined ? sql`` : sql` and l.id > ${after}`} order by l.id limit ${limit + 1}`,
        );
        return pageOf(rows, limit);
      });
    },

    listLinkEvents(actor, params = {}) {
      const p = parseInput(LinkEventsQuerySchema, params);
      const limit = p.limit ?? DEFAULT_EVENTS_LIMIT;
      // A outbox é da filial inteira (integração): só leitura ampla, não a visão de vendedor/gestor (E8).
      if (!canReadBroadly(actor, opts, 'link-events')) throw forbidden('Requer leitura ampla da filial');
      return db.transaction((tx) => {
        const scope = resolveScopeIds(tx, actor);
        if (p.branchId !== undefined && !scope.includes(p.branchId)) throw notFound();
        const branchIds = p.branchId === undefined ? scope : [p.branchId];
        if (branchIds.length === 0) return { items: [], nextAfter: null, hasMore: false };
        const perBranch = (branchId: number) =>
          tx.all<{
            id: number;
            kind: 'created' | 'ended';
            linkId: number;
            portfolioId: number;
            bId: number;
            bCode: string;
            cId: number;
            cnpj: string;
            gId: number;
            gCode: string;
            sId: number;
            sCode: string;
            occurredAt: number;
          }>(sql`
          select e.id as id, e.kind as kind, e.link_id as linkId, e.portfolio_id as portfolioId,
            b.id as bId, b.code as bCode, c.id as cId, c.cnpj as cnpj,
            g.id as gId, g.code as gCode, s.id as sId, s.code as sCode, e.occurred_at as occurredAt
          from portfolio_link_events e
          join branches b on b.id = e.branch_id
          join customers c on c.id = e.customer_id
          join product_subgroups g on g.id = e.product_subgroup_id
          join sellers s on s.id = e.seller_id
          where e.branch_id = ${branchId}
            and e.id > ${p.after ?? 0}
          order by e.id limit ${limit + 1}`);
        // Uma leitura por filial (índice (filial, id) já em ordem, sem ordenar) e intercalação por id.
        const rows = branchIds
          .flatMap(perBranch)
          .sort((x, y) => x.id - y.id)
          .slice(0, limit + 1);

        const slice = rows.slice(0, limit);
        const items: LinkEventItem[] = slice.map((r) => ({
          id: r.id,
          kind: r.kind,
          linkId: r.linkId,
          portfolioId: r.portfolioId,
          branch: { id: r.bId, code: r.bCode },
          customer: { id: r.cId, cnpj: r.cnpj },
          productSubgroup: { id: r.gId, code: r.gCode },
          seller: { id: r.sId, code: r.sCode },
          occurredAt: r.occurredAt,
        }));
        return {
          items,
          nextAfter: items.length > 0 ? (items[items.length - 1] as LinkEventItem).id : null,
          hasMore: rows.length > limit,
        };
      });
    },
  };
}
