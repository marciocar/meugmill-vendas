import { sql } from 'drizzle-orm';
import { loadAssignmentGrid } from '../distribution/grid.js';
import { conflictTotals } from '../conflicts/members.js';
import { bump, findScoped, openForEdit } from '../portfolios/access.js';
import { loadAggregateBase } from '../portfolios/aggregate.js';
import { resolveScopeIds, type Actor } from '../shared/authz.js';
import { writeTx, type Conn, type Db, type ServiceOptions } from '../shared/db.js';
import { DomainError, notFound } from '../shared/errors.js';
import { decodeCursor, encodeCursor, resolveLimit } from '../shared/pagination.js';
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
   * `active`. Mesma permissão, versão e regra de inativa da edição do E3. Erros 409 de regra:
   * `portfolio_has_conflicts` (clientes bloqueados), `portfolio_incomplete` (células sem vendedor válido)
   * e `link_conflict` (outra carteira da filial ainda mantém vínculo ativo numa célula a criar).
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
  c: number;
  g: number;
  s: number;
}

const keyOf = (c: number, g: number): string => `${c}.${g}`;

/** Carteiras da filial (fora a própria) com vínculo ativo em alguma das células a criar. */
function conflictingPortfolios(
  conn: Conn,
  branchId: number,
  portfolioId: number,
  rows: NewLinkRow[],
): number[] {
  if (rows.length === 0) return [];
  // CROSS JOIN fixa a ordem: percorre as linhas a criar e sonda o índice único parcial por célula
  // (sem isso o planejador pode varrer os vínculos ativos da filial para cada linha).
  return conn
    .all<{ id: number }>(
      sql`with cells as materialized (
          select json_extract(value, '$[0]') as c, json_extract(value, '$[1]') as g from json_each(${JSON.stringify(rows)})
        )
        select distinct l.portfolio_id as id
        from cells cross join portfolio_links l
          on l.branch_id = ${branchId} and l.customer_id = cells.c and l.product_subgroup_id = cells.g and l.active = 1
        where l.portfolio_id <> ${portfolioId}
        order by 1`,
    )
    .map((r) => r.id);
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
          sql`select id, customer_id as c, product_subgroup_id as g, seller_id as s
            from portfolio_links where portfolio_id = ${portfolioId} and active = 1 order by id`,
        );
        for (const l of active) {
          const key = keyOf(l.c, l.g);
          const want = desired.get(key);
          if (want && want[2] === l.s) {
            kept++;
            matched.add(key);
          } else toEnd.push(l.id); // saiu da grade ou trocou de vendedor (o novo é criado abaixo)
        }
        for (const [key, want] of desired) if (!matched.has(key)) toCreate.push(want);

        const at = now();
        if (toEnd.length === 0 && toCreate.length === 0 && row.status === 'active') {
          return { aggregate: loadAggregateBase(tx, portfolioId), created: 0, ended: 0, kept };
        }

        // Células a criar que outra carteira da filial ainda mantém ativas: recusa, sem encerrar nada
        // da outra. Os ids são de carteiras da mesma filial (visíveis ao ator).
        const others = conflictingPortfolios(tx, row.branchId, portfolioId, toCreate);
        if (others.length > 0) {
          throw new DomainError(
            'link_conflict',
            'Outra carteira da filial mantém vínculo ativo em clientes desta carteira: finalize-a novamente',
            { portfolioIds: others },
          );
        }

        // Encerrar antes de criar: o índice único parcial só admite um ativo por célula.
        endLinks(tx, toEnd, actor.sub, at);
        createLinks(tx, row, toCreate, actor.sub, at);
        bump(tx, row, actor, at, { status: 'active', finalizedAt: at, finalizedBy: actor.sub });
        return {
          aggregate: loadAggregateBase(tx, portfolioId),
          created: toCreate.length,
          ended: toEnd.length,
          kept,
        };
      });
    },

    listLinks(actor, portfolioId, params = {}) {
      const p = parseInput(LinkListQuerySchema, params);
      const limit = resolveLimit(p.limit);
      const after = decodeCursor(p.cursor);
      return db.transaction((tx) => {
        findScoped(tx, actor, portfolioId);
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
        findScoped(tx, actor, portfolioId);
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
