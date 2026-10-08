import { and, eq } from 'drizzle-orm';
import {
  customers,
  portfolioAssignments,
  portfolioLinks,
  productSubgroups,
  sellers,
} from '../../../db/schema.js';
import { MAX_ASSIGNMENT_ITEMS } from '../../distribution/schemas.js';
import { DomainError, invalid, notFound } from '../../shared/errors.js';
import type { Row } from '../layouts.js';
import {
  assertUnchangedSinceValidation,
  branchIdByCode,
  code,
  failOf,
  ok,
  required,
  scopedBranchId,
} from './common.js';
import { cnpjKey } from './master.js';
import { findPortfolio, portfolioKey } from './portfolios.js';
import type { Importer, RowFail, RowResult, Unit } from './types.js';

const UNIT_FAILED = 'Carteira não gravada: outra linha dela tem erro';
// Um id que nunca existe, diferente por linha (dois CNPJs sem cadastro não colidem na mesma célula).
const noCustomer = (line: number) => Number.MAX_SAFE_INTEGER - line;

interface Cell {
  row: Row;
  customerId: number;
  subgroupId: number;
  sellerId: number;
}

const cellKey = (customerId: number, subgroupId: number) => `${customerId}.${subgroupId}`;

/** Todas as linhas da unidade com o mesmo resultado. */
function all(unit: Unit, result: RowResult): Map<number, RowResult> {
  return new Map(unit.rows.map((r) => [r.line, result]));
}

/** As linhas com erro próprio mantêm o dele; as demais falham por estar na mesma carteira. */
function withUnitFailure(unit: Unit, own: Map<number, RowFail>): Map<number, RowResult> {
  const out = new Map<number, RowResult>();
  for (const r of unit.rows) {
    out.set(r.line, own.get(r.line) ?? { ok: false, code: 'validation_error', message: UNIT_FAILED });
  }
  return out;
}

function lookupId(
  conn: Parameters<typeof branchIdByCode>[0],
  table: typeof productSubgroups | typeof sellers,
  value: string,
  column: string,
): number {
  const row = conn.select({ id: table.id }).from(table).where(eq(table.code, value)).get();
  if (!row) throw invalid(`Código não encontrado: ${column}`);
  return row.id;
}

/**
 * Vínculos: o arquivo traz o conjunto COMPLETO de cada carteira citada. A unidade é a carteira: troca as
 * atribuições (E6, em lotes) e finaliza (E7), passando pela prévia (E4), pelos conflitos (E5) e pela grade
 * completa. Qualquer erro devolve a carteira inteira; o erro de uma atribuição aponta a linha dela.
 */
export const linkImporter: Importer = {
  keyOf(row) {
    const p = portfolioKey(row.get('filial_codigo'), row.get('carteira'));
    const cnpj = cnpjKey(row);
    const sub = row.get('subgrupo_codigo');
    return p === null || cnpj === null || sub === '' ? null : `${p}\u0000${cnpj}\u0000${sub}`;
  },

  units(rows) {
    const groups = new Map<string, Row[]>();
    const singles: Unit[] = [];
    for (const r of rows) {
      const key = portfolioKey(r.get('filial_codigo'), r.get('carteira'));
      if (key === null) {
        singles.push({ rows: [r] });
        continue;
      }
      const g = groups.get(key);
      if (g) g.push(r);
      else groups.set(key, [r]);
    }
    return [...[...groups.values()].map((g) => ({ rows: g })), ...singles];
  },

  apply(ctx, unit) {
    const first = unit.rows[0] as Row;
    // 1. Carteira (a mesma para todas as linhas da unidade).
    let portfolio;
    try {
      const branchId = scopedBranchId(ctx.db, ctx.actor, code(first, 'filial_codigo'), 'filial_codigo');
      const found = findPortfolio(ctx.db, branchId, required(first, 'carteira'));
      for (const r of unit.rows) assertUnchangedSinceValidation(ctx, r.line, found);
      if (!found) throw notFound();
      portfolio = ctx.services.portfolios.get(ctx.actor, found.id);
    } catch (err) {
      return all(unit, failOf(err));
    }
    const target = { id: portfolio.id, version: portfolio.version };

    // 2. Linhas: cliente, subgrupo e vendedor por código.
    const own = new Map<number, RowFail>();
    const cells: Cell[] = [];
    for (const r of unit.rows) {
      try {
        const cnpj = cnpjKey(r);
        if (cnpj === null) {
          required(r, 'cnpj');
          throw invalid('CNPJ inválido');
        }
        const customer = ctx.db
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.cnpj, cnpj))
          .get();
        cells.push({
          row: r,
          // CNPJ sem cadastro segue com um id que nunca existe: o E6 responde por ele exatamente como por um
          // cliente de outra filial ("não é membro efetivo"), e a simulação não revela o que existe.
          customerId: customer?.id ?? noCustomer(r.line),
          subgroupId: lookupId(ctx.db, productSubgroups, code(r, 'subgrupo_codigo'), 'subgrupo_codigo'),
          sellerId: lookupId(ctx.db, sellers, code(r, 'vendedor_codigo'), 'vendedor_codigo'),
        });
      } catch (err) {
        own.set(r.line, failOf(err) as RowFail);
      }
    }
    if (own.size > 0) return withUnitFailure(unit, own);

    // 3. Diferença contra as atribuições gravadas e os vínculos ativos.
    const assigned = new Map(
      ctx.db
        .select({
          c: portfolioAssignments.customerId,
          g: portfolioAssignments.productSubgroupId,
          s: portfolioAssignments.sellerId,
        })
        .from(portfolioAssignments)
        .where(eq(portfolioAssignments.portfolioId, portfolio.id))
        .all()
        .map((a) => [cellKey(a.c, a.g), a.s]),
    );
    const linked = new Map(
      ctx.db
        .select({
          c: portfolioLinks.customerId,
          g: portfolioLinks.productSubgroupId,
          s: portfolioLinks.sellerId,
        })
        .from(portfolioLinks)
        .where(and(eq(portfolioLinks.portfolioId, portfolio.id), eq(portfolioLinks.active, true)))
        .all()
        .map((l) => [cellKey(l.c, l.g), l.s]),
    );
    const wanted = new Set(cells.map((c) => cellKey(c.customerId, c.subgroupId)));
    const set = cells.filter((c) => assigned.get(cellKey(c.customerId, c.subgroupId)) !== c.sellerId);
    const clear = [...assigned.keys()]
      .filter((k) => !wanted.has(k))
      .map((k) => {
        const [c, g] = k.split('.').map(Number);
        return { customerId: c as number, productSubgroupId: g as number };
      });

    // 4. Atribuições (E6) em lotes; o índice do erro aponta a linha.
    let version = portfolio.version;
    try {
      for (let i = 0; i < clear.length; i += MAX_ASSIGNMENT_ITEMS) {
        version = ctx.services.distribution.replaceAssignments(ctx.actor, portfolio.id, version, {
          clear: clear.slice(i, i + MAX_ASSIGNMENT_ITEMS),
        }).version;
      }
      for (let i = 0; i < set.length; i += MAX_ASSIGNMENT_ITEMS) {
        const batch = set.slice(i, i + MAX_ASSIGNMENT_ITEMS);
        try {
          version = ctx.services.distribution.replaceAssignments(ctx.actor, portfolio.id, version, {
            set: batch.map((c) => ({
              customerId: c.customerId,
              productSubgroupId: c.subgroupId,
              sellerId: c.sellerId,
            })),
          }).version;
        } catch (err) {
          const m = err instanceof DomainError ? /^set\[(\d+)\]: (.+)$/.exec(err.message) : null;
          const cell = m ? batch[Number(m[1])] : undefined;
          if (!m || !cell) throw err;
          own.set(cell.row.line, { ok: false, code: 'validation_error', message: m[2] as string });
          return withUnitFailure(unit, own);
        }
      }
      // 5. Finalização (E7): conflitos, grade completa e vínculos.
      const result = ctx.services.links.finalize(ctx.actor, portfolio.id, version);
      const changedSeller = cells.filter((c) => {
        const s = linked.get(cellKey(c.customerId, c.subgroupId));
        return s !== undefined && s !== c.sellerId;
      }).length;
      ctx.stats.linksEnded = (ctx.stats.linksEnded ?? 0) + (result.ended - changedSeller);
      ctx.stats.linksTakenOver = (ctx.stats.linksTakenOver ?? 0) + result.takenOver;
      ctx.stats.portfoliosFinalized = (ctx.stats.portfoliosFinalized ?? 0) + 1;
    } catch (err) {
      return all(unit, failOf(err));
    }

    // 6. Ação por linha, contra os vínculos ativos de antes.
    return new Map(
      cells.map((c) => {
        const before = linked.get(cellKey(c.customerId, c.subgroupId));
        const action = before === undefined ? 'create' : before === c.sellerId ? 'unchanged' : 'update';
        return [c.row.line, ok(action, target)];
      }),
    );
  },
};
