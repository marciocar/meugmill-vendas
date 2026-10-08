import { inArray, sql } from 'drizzle-orm';
import { customers, productSubgroups, sellers } from '../../db/schema.js';
import { findScoped, openForEdit, bump } from '../portfolios/access.js';
import { loadAggregateBase } from '../portfolios/aggregate.js';
import type { PortfolioResponse } from '../portfolios/schemas.js';
import type { Actor } from '../shared/authz.js';
import { writeTx, type Conn, type Db, type ServiceOptions } from '../shared/db.js';
import { invalid } from '../shared/errors.js';
import { DEFAULT_LIMIT, resolveLimit } from '../shared/pagination.js';
import { parseInput } from '../shared/validate.js';
import { cells, invalidReason, loadGrid, loadStored, type CellStatus } from './grid.js';
import {
  AssignmentListQuerySchema,
  DistributeSchema,
  MAX_ASSIGNMENT_ITEMS,
  ReplaceAssignmentsSchema,
  type AssignmentItem,
  type AssignmentListParams,
  type AssignmentPage,
  type AssignmentSummary,
  type DistributeInput,
  type ReplaceAssignmentsInput,
  type SubgroupSummary,
} from './schemas.js';
import { balancedStrategy } from './strategies/balanced.js';
import type { DistributionStrategy } from './strategies/strategy.js';

export interface DistributeResult {
  aggregate: PortfolioResponse;
  /** Atribuições gravadas por subgrupo (só os subgrupos efetivamente distribuídos). */
  distributed: Record<number, number>;
  /** Subgrupos pedidos (ou todos) ignorados por não terem vendedor utilizável. */
  skippedSubgroupIds: number[];
  /**
   * Contagem FINAL por vendedor em cada subgrupo distribuído (não ignorado): as atribuições válidas
   * preservadas + as gravadas nesta execução; todos os vendedores utilizáveis, contagem 0 inclusive,
   * por código. O equilíbrio só vale sobre as células preenchidas nesta execução: as válidas
   * preservadas não são movidas, então a diferença final pode passar de 1.
   */
  finalCounts: Record<number, { sellerId: number; count: number }[]>;
}

export interface DistributionService {
  /** Células (cliente × subgrupo) paginadas por (cliente, subgrupo). Leitura da carteira. */
  listAssignments(actor: Actor, id: number, params?: AssignmentListParams): AssignmentPage;
  summary(actor: Actor, id: number): AssignmentSummary;
  /** Edição parcial e atômica (`set`/`clear`). Mesma permissão e versão da edição do E3. */
  replaceAssignments(
    actor: Actor,
    id: number,
    expectedVersion: number | undefined,
    input: ReplaceAssignmentsInput,
  ): PortfolioResponse;
  /**
   * Preenche só as células sem atribuição válida (`unassigned` e `stale`). Só incrementa a versão quando
   * grava alguma linha; sem nada a fazer devolve o agregado atual.
   */
  distribute(
    actor: Actor,
    id: number,
    expectedVersion: number | undefined,
    input?: DistributeInput,
  ): DistributeResult;
}

/** Cursor opaco: base64url de "cliente.subgrupo" da última célula entregue. */
function encodeCursor(customerId: number, subgroupId: number): string {
  return Buffer.from(`${customerId}.${subgroupId}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): [number, number] | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  const m = /^(\d{1,15})\.(\d{1,15})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!m) throw invalid('Campo inválido: cursor');
  return [Number(m[1]), Number(m[2])];
}

/** Upsert em lote por `json_each`: uma instrução, um único parâmetro com todas as linhas. */
function upsertAssignments(
  conn: Conn,
  portfolioId: number,
  rows: [customerId: number, subgroupId: number, sellerId: number][],
  sub: string,
  at: number,
): void {
  if (rows.length === 0) return;
  conn.run(sql`
    insert into portfolio_assignments
      (portfolio_id, customer_id, product_subgroup_id, seller_id, created_at, created_by, updated_at, updated_by)
    select ${portfolioId}, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
      ${at}, ${sub}, ${at}, ${sub}
    from json_each(${JSON.stringify(rows)}) where true
    on conflict (portfolio_id, customer_id, product_subgroup_id) do update set
      seller_id = excluded.seller_id, updated_at = excluded.updated_at, updated_by = excluded.updated_by`);
}

function deleteAssignments(conn: Conn, portfolioId: number, rows: [number, number][]): void {
  if (rows.length === 0) return;
  conn.run(sql`
    delete from portfolio_assignments
    where portfolio_id = ${portfolioId}
      and (customer_id, product_subgroup_id) in (
        select json_extract(value, '$[0]'), json_extract(value, '$[1]') from json_each(${JSON.stringify(rows)}))`);
}

export function createDistributionService(
  db: Db,
  opts: ServiceOptions & { strategy?: DistributionStrategy } = {},
): DistributionService {
  const now = opts.now ?? Date.now;
  const strategy = opts.strategy ?? balancedStrategy;

  const subgroupMap = (conn: Conn, ids: number[]) =>
    new Map(
      ids.length === 0
        ? []
        : conn
            .select({ id: productSubgroups.id, code: productSubgroups.code, name: productSubgroups.name })
            .from(productSubgroups)
            .where(inArray(productSubgroups.id, ids))
            .all()
            .map((r) => [r.id, r] as const),
    );
  const sellerMap = (conn: Conn, ids: number[]) =>
    new Map(
      ids.length === 0
        ? []
        : conn
            .select({ id: sellers.id, code: sellers.code, name: sellers.name })
            .from(sellers)
            .where(inArray(sellers.id, ids))
            .all()
            .map((r) => [r.id, r] as const),
    );

  return {
    listAssignments(actor, id, params = {}) {
      const p = parseInput(AssignmentListQuerySchema, params);
      const limit = resolveLimit(p.limit ?? DEFAULT_LIMIT);
      const after = decodeCursor(p.cursor);
      // Retrato único: grade, gravadas e dados de exibição na mesma transação de leitura.
      return db.transaction((db) => {
        const portfolio = findScoped(db, actor, id);
        const grid = loadGrid(db, portfolio);
        const stored = loadStored(db, id);

        let total = 0;
        let more = false;
        const page: {
          customerId: number;
          subgroupId: number;
          sellerId: number | null;
          status: CellStatus;
        }[] = [];
        for (const c of cells(grid, stored)) {
          if (p.productSubgroupId !== undefined && c.subgroupId !== p.productSubgroupId) continue;
          if (p.sellerId !== undefined && c.sellerId !== p.sellerId) continue;
          if (p.status !== undefined && c.status !== p.status) continue;
          total++;
          if (more) continue;
          if (
            after !== undefined &&
            (c.customerId < after[0] || (c.customerId === after[0] && c.subgroupId <= after[1]))
          ) {
            continue;
          }
          if (page.length === limit) more = true;
          else page.push(c);
        }

        const customerRows = page.length
          ? db
              .select({ id: customers.id, cnpj: customers.cnpj, legalName: customers.legalName })
              .from(customers)
              .where(inArray(customers.id, [...new Set(page.map((c) => c.customerId))]))
              .all()
          : [];
        const customerById = new Map(customerRows.map((r) => [r.id, r]));
        const subgroupById = subgroupMap(db, [...new Set(page.map((c) => c.subgroupId))]);
        const sellerById = sellerMap(db, [
          ...new Set(page.flatMap((c) => (c.sellerId === null ? [] : [c.sellerId]))),
        ]);
        const items: AssignmentItem[] = page.map((c) => ({
          customer: customerById.get(c.customerId) as AssignmentItem['customer'],
          productSubgroup: subgroupById.get(c.subgroupId) as AssignmentItem['productSubgroup'],
          seller: c.sellerId === null ? null : (sellerById.get(c.sellerId) ?? null),
          status: c.status,
        }));
        const last = page[page.length - 1];
        return {
          items,
          nextCursor: more && last ? encodeCursor(last.customerId, last.subgroupId) : null,
          total,
        };
      });
    },

    summary(actor, id) {
      // Retrato único: grade, gravadas e dados de exibição na mesma transação de leitura.
      return db.transaction((db) => {
        const portfolio = findScoped(db, actor, id);
        const grid = loadGrid(db, portfolio);
        const perSubgroup = new Map(
          grid.subgroupIds.map((g) => [g, { counts: new Map<number, number>(), unassigned: 0, stale: 0 }]),
        );
        const totals = { members: grid.memberIds.length, cells: 0, assigned: 0, unassigned: 0, stale: 0 };
        for (const c of cells(grid, loadStored(db, id))) {
          if (c.inGrid) totals.cells++;
          totals[c.status]++;
          const bucket = perSubgroup.get(c.subgroupId);
          if (!bucket) continue; // gravada em subgrupo que saiu da carteira: só entra nos totais
          if (c.status === 'assigned') {
            bucket.counts.set(c.sellerId as number, (bucket.counts.get(c.sellerId as number) ?? 0) + 1);
          } else bucket[c.status]++;
        }
        const sellerById = sellerMap(db, [...new Set(grid.pairs.map((x) => x.sellerId))]);
        const subgroupById = subgroupMap(db, grid.subgroupIds);
        const subgroups: SubgroupSummary[] = grid.subgroupIds.map((g) => {
          const bucket = perSubgroup.get(g) as NonNullable<ReturnType<typeof perSubgroup.get>>;
          return {
            productSubgroup: subgroupById.get(g) as SubgroupSummary['productSubgroup'],
            sellers: grid.pairs
              .filter((x) => x.subgroupId === g)
              .sort((a, b) => (a.sellerCode < b.sellerCode ? -1 : 1))
              .map((x) => ({
                seller: sellerById.get(x.sellerId) as SubgroupSummary['sellers'][number]['seller'],
                count: bucket.counts.get(x.sellerId) ?? 0,
              })),
            unassigned: bucket.unassigned,
            stale: bucket.stale,
          };
        });
        return { subgroups, totals };
      });
    },

    replaceAssignments(actor, id, expectedVersion, input) {
      return writeTx(db, (tx) => {
        const row = openForEdit(tx, actor, id, expectedVersion);
        const data = parseInput(ReplaceAssignmentsSchema, input);
        const set = data.set ?? [];
        const clear = data.clear ?? [];
        if (set.length + clear.length === 0) throw invalid('Informe ao menos um item em set ou clear');
        if (set.length + clear.length > MAX_ASSIGNMENT_ITEMS) {
          throw invalid(`Máximo de ${MAX_ASSIGNMENT_ITEMS} itens por chamada`);
        }
        const seen = new Set<string>();
        for (const x of [...set, ...clear]) {
          const key = `${x.customerId}.${x.productSubgroupId}`;
          if (seen.has(key)) throw invalid('Célula (cliente, subgrupo) repetida');
          seen.add(key);
        }
        if (set.length > 0) {
          const grid = loadGrid(tx, row);
          // O índice localiza o item em lotes de até 5.000; a mensagem não ecoa ids nem valores. Cliente
          // inexistente, de outra filial ou sem vínculo ativo não são membros efetivos: mesma mensagem.
          for (const [i, s] of set.entries()) {
            const reason = invalidReason(grid, s.customerId, s.productSubgroupId, s.sellerId);
            if (reason !== null) throw invalid(`set[${i}]: ${reason}`);
          }
        }
        deleteAssignments(
          tx,
          id,
          clear.map((x) => [x.customerId, x.productSubgroupId]),
        );
        upsertAssignments(
          tx,
          id,
          set.map((x) => [x.customerId, x.productSubgroupId, x.sellerId]),
          actor.sub,
          now(),
        );
        bump(tx, row, actor, now());
        return loadAggregateBase(tx, id);
      });
    },

    distribute(actor, id, expectedVersion, input = {}) {
      return writeTx(db, (tx) => {
        const row = openForEdit(tx, actor, id, expectedVersion);
        const data = parseInput(DistributeSchema, input);
        const grid = loadGrid(tx, row);
        let targets = grid.subgroupIds;
        if (data.productSubgroupIds !== undefined) {
          if (new Set(data.productSubgroupIds).size !== data.productSubgroupIds.length) {
            throw invalid('Subgrupo repetido');
          }
          if (data.productSubgroupIds.some((g) => !grid.usable.has(g))) {
            throw invalid('Subgrupo não pertence à carteira');
          }
          const wanted = new Set(data.productSubgroupIds);
          targets = grid.subgroupIds.filter((g) => wanted.has(g));
        }
        const targetSet = new Set(targets);

        // Uma passada: contagem válida por vendedor e células a preencher, por subgrupo.
        const validCounts = new Map<number, Map<number, number>>(targets.map((g) => [g, new Map()]));
        const toFill = new Map<number, number[]>(targets.map((g) => [g, []]));
        for (const c of cells(grid, loadStored(tx, id))) {
          if (!targetSet.has(c.subgroupId)) continue;
          if (c.status === 'assigned') {
            const m = validCounts.get(c.subgroupId) as Map<number, number>;
            m.set(c.sellerId as number, (m.get(c.sellerId as number) ?? 0) + 1);
          } else if (c.inGrid) (toFill.get(c.subgroupId) as number[]).push(c.customerId);
        }

        const rows: [number, number, number][] = [];
        const finalCounts: DistributeResult['finalCounts'] = {};
        const distributed: Record<number, number> = {};
        const skippedSubgroupIds: number[] = [];
        for (const g of targets) {
          const candidates = grid.pairs
            .filter((x) => x.subgroupId === g && x.usable)
            .map((x) => ({ id: x.sellerId, code: x.sellerCode }));
          if (candidates.length === 0) {
            skippedSubgroupIds.push(g);
            continue;
          }
          const customerIds = toFill.get(g) as number[];
          const picked = strategy.assign({
            sellers: candidates,
            validCounts: validCounts.get(g) as Map<number, number>,
            customerIds,
          });
          for (let i = 0; i < customerIds.length; i++) {
            rows.push([customerIds[i] as number, g, picked[i] as number]);
          }
          distributed[g] = customerIds.length;
          // Contagem final = válidas preservadas + gravadas agora.
          const total = new Map(validCounts.get(g) as Map<number, number>);
          for (const sellerId of picked) total.set(sellerId, (total.get(sellerId) ?? 0) + 1);
          finalCounts[g] = [...candidates]
            .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
            .map((x) => ({ sellerId: x.id, count: total.get(x.id) ?? 0 }));
        }
        // Sem nada a gravar, a versão (e o ETag) não muda.
        if (rows.length > 0) {
          upsertAssignments(tx, id, rows, actor.sub, now());
          bump(tx, row, actor, now());
        }
        return { aggregate: loadAggregateBase(tx, id), distributed, skippedSubgroupIds, finalCounts };
      });
    },
  };
}
