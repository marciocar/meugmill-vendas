import { economicGroups, retailNetworks, states } from '../../db/schema.js';
import { createBranchService } from '../branches/service.js';
import {
  createEconomicGroupService,
  createProductSubgroupService,
  createRetailNetworkService,
  type CatalogService,
} from '../catalog/service.js';
import { createCustomerService } from '../customers/service.js';
import { createLinkService } from '../links/service.js';
import { createPortfolioService } from '../portfolios/service.js';
import type { RegionResponse } from '../portfolios/schemas.js';
import { createSellerService } from '../sellers/service.js';
import type { Actor } from '../shared/authz.js';
import type { Db, ServiceOptions } from '../shared/db.js';
import { DomainError, invalid } from '../shared/errors.js';
import { MAX_LIMIT, type Page } from '../shared/pagination.js';
import { assertRolesWellFormed } from '../visibility/profiles.js';
import { BOM, csvLine, joinList } from './codec.js';
import { LAYOUTS, headerOf, isLayoutId, type LayoutId } from './layouts.js';

export interface ExportService {
  /**
   * Abre a exportação: confere o ator e o layout ANTES do primeiro byte e devolve um gerador de pedaços
   * de texto (BOM + cabeçalho, depois uma página por vez). O conteúdo segue o escopo e a visibilidade
   * de cada listagem (E2–E8): é o que o usuário leria pela API.
   */
  open(actor: Actor, layout: string): { layout: LayoutId; chunks: Generator<string> };
}

const yesNo = (active: boolean) => (active ? 'S' : 'N');

/** Todas as páginas de uma listagem por cursor. */
function* pages<T>(fetch: (cursor: string | undefined) => Page<T>): Generator<T[]> {
  let cursor: string | undefined;
  do {
    const page = fetch(cursor);
    yield page.items;
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
}

function regionText(r: RegionResponse): string {
  if (r.level === 'state') return r.uf;
  if (r.level === 'municipality') return `${r.uf}/${r.municipalityCode}`;
  return `${r.uf}/${r.municipalityCode}/${r.neighborhoodLabel}`;
}

/** Exportação de CSV (E10), no mesmo layout da importação: a volta do arquivo sai `unchanged`. */
export function createExportService(db: Db, opts: ServiceOptions = {}): ExportService {
  const svc = {
    branches: createBranchService(db, opts),
    productSubgroups: createProductSubgroupService(db, opts),
    retailNetworks: createRetailNetworkService(db, opts),
    economicGroups: createEconomicGroupService(db, opts),
    sellers: createSellerService(db, opts),
    customers: createCustomerService(db, opts),
    portfolios: createPortfolioService(db, opts),
    links: createLinkService(db, opts),
  };
  const page = { limit: MAX_LIMIT };

  const codeMap = (table: typeof retailNetworks | typeof economicGroups) =>
    new Map(
      db
        .select({ id: table.id, code: table.code })
        .from(table)
        .all()
        .map((r) => [r.id, r.code]),
    );

  function* catalog(actor: Actor, s: CatalogService): Generator<string> {
    for (const items of pages((cursor) => s.list(actor, { ...page, cursor }))) {
      yield items.map((r) => csvLine([r.code, r.name, yesNo(r.active)])).join('');
    }
  }

  const bodies: Record<LayoutId, (actor: Actor) => Generator<string>> = {
    *branches(actor) {
      for (const items of pages((cursor) => svc.branches.list(actor, { ...page, cursor }))) {
        yield items.map((r) => csvLine([r.code, r.name, r.municipalityCode, yesNo(r.active)])).join('');
      }
    },
    'product-subgroups': (actor) => catalog(actor, svc.productSubgroups),
    'retail-networks': (actor) => catalog(actor, svc.retailNetworks),
    'economic-groups': (actor) => catalog(actor, svc.economicGroups),
    *sellers(actor) {
      for (const items of pages((cursor) => svc.sellers.list(actor, { ...page, cursor }))) {
        yield items
          .map((r) => csvLine([r.code, r.name, joinList(r.branches.map((b) => b.code)), yesNo(r.active)]))
          .join('');
      }
    },
    *customers(actor) {
      const networks = codeMap(retailNetworks);
      const groups = codeMap(economicGroups);
      const ufs = new Map(
        db
          .select({ code: states.ibgeCode, uf: states.uf })
          .from(states)
          .all()
          .map((s) => [s.code, s.uf]),
      );
      for (const items of pages((cursor) => svc.customers.list(actor, { ...page, cursor }))) {
        yield items
          .map((r) =>
            csvLine([
              r.cnpj,
              r.legalName,
              r.tradeName,
              ufs.get(r.stateCode),
              r.municipalityCode,
              r.neighborhood,
              r.retailNetworkId === null ? null : networks.get(r.retailNetworkId),
              r.economicGroupId === null ? null : groups.get(r.economicGroupId),
              joinList(r.branches.map((b) => b.code)),
              yesNo(r.active),
            ]),
          )
          .join('');
      }
    },
    *portfolios(actor) {
      for (const items of pages((cursor) => svc.portfolios.list(actor, { ...page, cursor }))) {
        const out: string[] = [];
        for (const item of items) {
          const p = svc.portfolios.get(actor, item.id);
          out.push(
            csvLine([
              p.branch.code,
              p.name,
              p.type.code,
              p.responsibleSub,
              p.description,
              joinList(p.filters.regions.map(regionText)),
              joinList(p.filters.retailNetworks.map((n) => n.code)),
              joinList(p.filters.economicGroups.map((g) => g.code)),
              joinList(p.sellers.map((s) => `${s.productSubgroup.code}:${s.seller.code}`)),
              p.status === 'active' ? 'ativa' : 'rascunho',
              yesNo(p.active),
            ]),
          );
        }
        yield out.join('');
      }
    },
    *links(actor) {
      for (const items of pages((cursor) => svc.portfolios.list(actor, { ...page, cursor }))) {
        for (const item of items) {
          let linkPages: Generator<Awaited<ReturnType<typeof svc.links.listLinks>>['items']>;
          try {
            // A leitura dos vínculos tem a regra própria (E8): sem acesso, a carteira fica de fora.
            svc.links.listLinks(actor, item.id, { limit: 1 });
            linkPages = pages((cursor) => svc.links.listLinks(actor, item.id, { ...page, cursor }));
          } catch (err) {
            if (err instanceof DomainError && (err.code === 'forbidden' || err.code === 'not_found'))
              continue;
            throw err;
          }
          for (const links of linkPages) {
            yield links
              .map((l) =>
                csvLine([
                  item.branch.code,
                  item.name,
                  l.customer.cnpj,
                  l.productSubgroup.code,
                  l.seller.code,
                ]),
              )
              .join('');
          }
        }
      }
    },
  };

  return {
    open(actor, layout) {
      assertRolesWellFormed(actor, opts);
      if (!isLayoutId(layout)) throw invalid('Layout inválido');
      const body = bodies[layout];
      function* chunks(): Generator<string> {
        yield BOM + csvLine(headerOf(LAYOUTS[layout as LayoutId]));
        yield* body(actor);
      }
      return { layout, chunks: chunks() };
    },
  };
}
