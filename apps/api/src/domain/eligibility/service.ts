import { eq, inArray, sql } from 'drizzle-orm';
import { customers, municipalities, portfolioCustomerOverrides } from '../../db/schema.js';
import { loadAggregateBase } from '../portfolios/aggregate.js';
import { bump, findReadable, openForEdit } from '../portfolios/access.js';
import { type Actor } from '../shared/authz.js';
import { writeTx, type Conn, type Db, type ServiceOptions } from '../shared/db.js';
import { invalid } from '../shared/errors.js';
import { parseInput } from '../shared/validate.js';
import type { PortfolioResponse } from '../portfolios/schemas.js';
import { assertNoDuplicates } from '../portfolios/validate.js';
import { eligibilityOf, loadPortfolioCriteria, previewPage } from './query.js';
import {
  MAX_OVERRIDES,
  PreviewQuerySchema,
  ReplaceOverridesSchema,
  type OverridesResponse,
  type PreviewCustomer,
  type PreviewQuery,
  type PreviewResponse,
  type ReplaceOverridesInput,
} from './schemas.js';

export interface EligibilityService {
  /** Página da prévia (filtros + ajustes), na regra de leitura da carteira. */
  preview(actor: Actor, portfolioId: number, params?: PreviewQuery): PreviewResponse;
  /** Ajustes manuais, com a marca de efetividade de cada um. */
  getOverrides(actor: Actor, portfolioId: number): OverridesResponse;
  /** Substitui os ajustes (edição: admin da filial ou responsável). Devolve o agregado. */
  replaceOverrides(
    actor: Actor,
    portfolioId: number,
    expectedVersion: number | undefined,
    input: ReplaceOverridesInput,
  ): PortfolioResponse;
}

const BATCH = 500;

/** Dados de empresa dos clientes, em lote (uma consulta por bloco de ids). */
function customersById(conn: Conn, ids: number[]): Map<number, PreviewCustomer> {
  const out = new Map<number, PreviewCustomer>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const rows = conn
      .select({
        id: customers.id,
        cnpj: customers.cnpj,
        legalName: customers.legalName,
        tradeName: customers.tradeName,
        stateCode: customers.stateCode,
        municipalityCode: customers.municipalityCode,
        municipalityName: municipalities.name,
        neighborhood: customers.neighborhood,
      })
      .from(customers)
      .innerJoin(municipalities, eq(municipalities.ibgeCode, customers.municipalityCode))
      .where(inArray(customers.id, ids.slice(i, i + BATCH)))
      .all();
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

export function createEligibilityService(db: Db, opts: ServiceOptions = {}): EligibilityService {
  const now = opts.now ?? Date.now;

  /** Ids de clientes que existem E têm vínculo (ativo ou não) com alguma das filiais dadas. */
  function idsLinkedTo(conn: Conn, branchIds: number[], ids: number[]): Set<number> {
    const found = new Set<number>();
    if (branchIds.length === 0) return found;
    const branchList = sql.join(
      branchIds.map((id) => sql`${id}`),
      sql`, `,
    );
    for (let i = 0; i < ids.length; i += BATCH) {
      const rows = conn.all<{ id: number }>(
        sql`select c.id as id from customers c
          where c.id in (${sql.join(
            ids.slice(i, i + BATCH).map((id) => sql`${id}`),
            sql`, `,
          )})
            and exists (select 1 from customer_branches cb
                         where cb.customer_id = c.id and cb.branch_id in (${branchList}))`,
      );
      for (const r of rows) found.add(r.id);
    }
    return found;
  }

  return {
    preview(actor, portfolioId, params = {}) {
      const p = parseInput(PreviewQuerySchema, params);
      findReadable(db, actor, portfolioId, opts);
      const page = previewPage(db, loadPortfolioCriteria(db, portfolioId), { portfolioId, ...p });
      const data = customersById(
        db,
        page.items.map((i) => i.customerId),
      );
      return {
        items: page.items.flatMap(({ customerId, ...rest }) => {
          const customer = data.get(customerId);
          return customer ? [{ customer, ...rest }] : [];
        }),
        nextCursor: page.nextCursor,
        total: page.total,
      };
    },

    getOverrides(actor, portfolioId) {
      const portfolio = findReadable(db, actor, portfolioId, opts);
      const rows = db
        .select({ customerId: portfolioCustomerOverrides.customerId, kind: portfolioCustomerOverrides.kind })
        .from(portfolioCustomerOverrides)
        .where(eq(portfolioCustomerOverrides.portfolioId, portfolioId))
        .orderBy(portfolioCustomerOverrides.customerId)
        .all();
      // Só aparecem ajustes de clientes com vínculo (ativo ou não) com a filial da carteira; os demais
      // (órfãos, p.ex. após o cliente perder o vínculo) são omitidos, sem sinal de que existem.
      const visible = idsLinkedTo(
        db,
        [portfolio.branchId],
        rows.map((r) => r.customerId),
      );
      const ids = rows.map((r) => r.customerId).filter((id) => visible.has(id));
      const data = customersById(db, ids);
      const state = eligibilityOf(db, loadPortfolioCriteria(db, portfolioId), portfolioId, ids);
      const out: OverridesResponse = { include: [], exclude: [] };
      for (const r of rows) {
        const customer = visible.has(r.customerId) ? data.get(r.customerId) : undefined;
        if (!customer) continue;
        const s = state.get(r.customerId);
        const effective = r.kind === 'include' ? s?.member === true : s?.byFilter === true;
        out[r.kind].push({ customer, effective });
      }
      return out;
    },

    replaceOverrides(actor, portfolioId, expectedVersion, input) {
      return writeTx(db, (tx) => {
        const row = openForEdit(tx, actor, portfolioId, expectedVersion);
        const data = parseInput(ReplaceOverridesSchema, input);
        const all = [...data.include, ...data.exclude];
        if (all.length > MAX_OVERRIDES) throw invalid('Limite de ajustes excedido');
        assertNoDuplicates(all, String, 'Cliente repetido nos ajustes');

        // Existência e vínculo com a FILIAL DA CARTEIRA (não com o escopo do ator) juntos: inexistente
        // e fora da filial dão a mesma resposta. O vínculo pode estar inativo (exclusão); inclusão
        // exige vínculo ativo, validado abaixo.
        const linked = idsLinkedTo(tx, [row.branchId], all);
        if (all.some((id) => !linked.has(id))) throw invalid('Cliente inválido ou fora do escopo');

        const state = eligibilityOf(tx, loadPortfolioCriteria(tx, portfolioId), portfolioId, data.include);
        if (data.include.some((id) => !state.get(id)?.member)) {
          throw invalid('Inclusão inválida: cliente inativo ou sem vínculo ativo na filial');
        }

        tx.delete(portfolioCustomerOverrides)
          .where(eq(portfolioCustomerOverrides.portfolioId, portfolioId))
          .run();
        const at = now();
        const values = [
          ...data.include.map((customerId) => ({ customerId, kind: 'include' as const })),
          ...data.exclude.map((customerId) => ({ customerId, kind: 'exclude' as const })),
        ].map((v) => ({ portfolioId, ...v, createdAt: at, createdBy: actor.sub }));
        for (let i = 0; i < values.length; i += BATCH) {
          tx.insert(portfolioCustomerOverrides)
            .values(values.slice(i, i + BATCH))
            .run();
        }
        bump(tx, row, actor, at);
        return loadAggregateBase(tx, portfolioId);
      });
    },
  };
}
