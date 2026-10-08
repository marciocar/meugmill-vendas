import { and, sql, type SQL } from 'drizzle-orm';
import { customers } from '../../db/schema.js';
import { customerSearchClause } from '../customers/search.js';
import type { Actor } from '../shared/authz.js';
import type { Db, ServiceOptions } from '../shared/db.js';
import { decodeCursor, encodeCursor, resolveLimit } from '../shared/pagination.js';
import { parseInput } from '../shared/validate.js';
import { accessMode, canReadBroadly, effectiveProfiles, hasProfile, PROFILE } from './profiles.js';
import {
  CheckBodySchema,
  MyCustomersQuerySchema,
  type CheckResponse,
  type MyCustomersParams,
  type VisibilitySummary,
  type VisibleCustomer,
  type VisibleCustomersPage,
} from './schemas.js';
import { visibleCustomersSql, visibleSources, type ViaProfile } from './sql.js';

export interface VisibilityService {
  /** Perfis efetivos do ator e quantos clientes cada um (e a união) enxerga. */
  summary(actor: Actor): VisibilitySummary;
  /**
   * Clientes visíveis ao ator, por id, com os dados de empresa e o motivo (`via`: subgrupo, carteira e
   * perfil dos vínculos ativos). Filtros: busca `q` e `productSubgroupId` (vínculo visível naquele subgrupo).
   */
  listMyCustomers(actor: Actor, params?: MyCustomersParams): VisibleCustomersPage;
  /**
   * Dos ids pedidos (até 1.000, distintos), devolve os visíveis ao ator. Inexistente e invisível são
   * indistinguíveis: os ausentes simplesmente não voltam.
   */
  check(actor: Actor, customerIds: number[]): CheckResponse;
}

interface CustomerRowRaw {
  id: number;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  stateCode: number;
  municipalityCode: number;
  neighborhood: string;
}

export function createVisibilityService(db: Db, opts: ServiceOptions = {}): VisibilityService {
  const countOf = (select: SQL): number =>
    db.get<{ n: number }>(sql`select count(*) as n from (${select})`).n;

  return {
    summary(actor) {
      const broad = canReadBroadly(actor, opts, 'visibility');
      const byProfile: Record<string, number> = {};
      for (const source of visibleSources(actor, broad)) {
        const n = countOf(source.customers());
        if (source.profile === 'legacy') byProfile['legacy'] = n;
        else if (source.profile === PROFILE.admin || source.profile === PROFILE.supervision) {
          // A leitura ampla é uma só consulta: vale para admin e supervisão presentes.
          for (const p of [PROFILE.admin, PROFILE.supervision]) if (hasProfile(actor, p)) byProfile[p] = n;
        } else byProfile[source.profile] = n;
      }
      const seller = hasProfile(actor, PROFILE.seller)
        ? (db.get<{ id: number; code: string } | undefined>(
            sql`select id, code from sellers where user_sub = ${actor.sub}`,
          ) ?? null)
        : null;
      return {
        profiles: effectiveProfiles(actor),
        mode: accessMode(actor),
        seller,
        visibleCustomers: countOf(visibleCustomersSql(actor, broad)),
        byProfile,
      };
    },

    listMyCustomers(actor, params = {}) {
      const p = parseInput(MyCustomersQuerySchema, params);
      const limit = resolveLimit(p.limit);
      const after = decodeCursor(p.cursor);
      const broad = canReadBroadly(actor, opts, 'visibility');
      const sources = visibleSources(actor, broad);
      if (sources.length === 0) return { items: [], nextCursor: null, total: 0 };

      const subgroup =
        p.productSubgroupId === undefined
          ? undefined
          : sql`${customers.id} in (select customer_id from (${sql.join(
              sources.map((s) => s.links()),
              sql` union `,
            )}) where product_subgroup_id = ${p.productSubgroupId})`;
      const base = [
        sql`${customers.id} in (select customer_id from (${visibleCustomersSql(actor, broad)}))`,
        subgroup,
        customerSearchClause(p.q),
      ];
      const total = db.get<{ n: number }>(
        sql`select count(*) as n from ${customers} where ${and(...base)}`,
      ).n;
      const rows = db.all<CustomerRowRaw>(
        sql`select ${customers.id} as id, ${customers.cnpj} as cnpj, ${customers.legalName} as legalName,
            ${customers.tradeName} as tradeName, ${customers.stateCode} as stateCode,
            ${customers.municipalityCode} as municipalityCode, ${customers.neighborhood} as neighborhood
          from ${customers}
          where ${and(...base, after === undefined ? undefined : sql`${customers.id} > ${after}`)}
          order by ${customers.id} limit ${limit + 1}`,
      );
      const page = rows.slice(0, limit);
      const via = new Map<number, VisibleCustomer['via']>();
      if (page.length > 0) {
        const ids = page.map((r) => r.id);
        const links = db.all<{
          customer_id: number;
          product_subgroup_id: number;
          portfolio_id: number;
          profile: ViaProfile;
        }>(
          sql`select customer_id, product_subgroup_id, portfolio_id, profile from (${sql.join(
            sources.map((s) => s.links(ids)),
            sql` union `,
          )}) order by customer_id, portfolio_id, product_subgroup_id, profile`,
        );
        for (const l of links) {
          const list = via.get(l.customer_id) ?? [];
          list.push({
            productSubgroupId: l.product_subgroup_id,
            portfolioId: l.portfolio_id,
            profile: l.profile,
          });
          via.set(l.customer_id, list);
        }
      }
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({ ...r, via: via.get(r.id) ?? [] })),
        nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null,
        total,
      };
    },

    check(actor, customerIds) {
      const body = parseInput(CheckBodySchema, { customerIds });
      const broad = canReadBroadly(actor, opts, 'visibility');
      if (body.customerIds.length === 0) return { visible: [] };
      const rows = db.all<{ customer_id: number }>(
        sql`select customer_id from (${visibleCustomersSql(actor, broad, body.customerIds)}) order by customer_id`,
      );
      return { visible: rows.map((r) => r.customer_id) };
    },
  };
}
