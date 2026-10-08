import { eq } from 'drizzle-orm';
import {
  branches,
  customers,
  economicGroups,
  productSubgroups,
  retailNetworks,
  sellers,
} from '../../../db/schema.js';
import type { CatalogService } from '../../catalog/service.js';
import type { CustomerResponse } from '../../customers/schemas.js';
import { isValidCnpj, normalizeCnpj } from '../../shared/cnpj.js';
import type { Conn } from '../../shared/db.js';
import { DomainError, invalid } from '../../shared/errors.js';
import { cleanOptionalText } from '../../shared/validate.js';
import {
  active,
  applyActive,
  assertUnchangedSinceValidation,
  branchIdsByCodes,
  clean,
  code,
  codeList,
  integer,
  ok,
  optionalCode,
  required,
  sameSet,
  single,
} from './common.js';
import type { ImportContext, Importer, RowResult } from './types.js';
import type { Row } from '../layouts.js';

type CodeTable = typeof productSubgroups | typeof retailNetworks | typeof economicGroups;

/** Linha bruta por código (ativa ou não), sem escopo: só para decidir entre criar e atualizar. */
function findByCode(conn: Conn, table: CodeTable | typeof branches | typeof sellers, value: string) {
  return conn.select({ id: table.id, version: table.version }).from(table).where(eq(table.code, value)).get();
}

/** Id de cadastro de referência por código; vazio vira `null`. */
function refId(conn: Conn, table: CodeTable, value: string | null, column: string): number | null {
  if (value === null) return null;
  const row = findByCode(conn, table, value);
  if (!row) throw invalid(`Código não encontrado: ${column}`);
  return row.id;
}

/** Subgrupos, redes e grupos econômicos: código + nome + ativo. */
export function catalogImporter(table: CodeTable, pick: (ctx: ImportContext) => CatalogService): Importer {
  return {
    keyOf: (row) => row.get('codigo') || null,
    apply(ctx, unit) {
      const row = unit.rows[0] as Row;
      return single(row, (): RowResult => {
        const svc = pick(ctx);
        const c = code(row, 'codigo');
        const name = clean(required(row, 'nome'));
        const wantActive = active(row);
        const found = findByCode(ctx.db, table, c) ?? null;
        assertUnchangedSinceValidation(ctx, row.line, found);
        if (!found) {
          const created = svc.create(ctx.actor, { code: c, name });
          const activation = applyActive(created, wantActive, {
            deactivate: (v) => svc.deactivate(ctx.actor, created.id, v),
            reactivate: (v) => svc.reactivate(ctx.actor, created.id, v),
          });
          return ok('create', null, activation);
        }
        let current = svc.get(ctx.actor, found.id);
        const changed = current.name !== name;
        if (changed) current = svc.update(ctx.actor, found.id, current.version, { name });
        const activation = applyActive(current, wantActive, {
          deactivate: (v) => svc.deactivate(ctx.actor, found.id, v),
          reactivate: (v) => svc.reactivate(ctx.actor, found.id, v),
        });
        return ok(changed ? 'update' : 'unchanged', found, activation);
      });
    },
  };
}

export const branchImporter: Importer = {
  keyOf: (row) => row.get('codigo') || null,
  apply(ctx, unit) {
    const row = unit.rows[0] as Row;
    return single(row, (): RowResult => {
      const svc = ctx.services.branches;
      const c = code(row, 'codigo');
      const name = clean(required(row, 'nome'));
      const municipalityCode = integer(row, 'municipio_ibge');
      const wantActive = active(row);
      const found = findByCode(ctx.db, branches, c) ?? null;
      assertUnchangedSinceValidation(ctx, row.line, found);
      if (!found) {
        const created = svc.create(ctx.actor, { code: c, name, municipalityCode });
        const activation = applyActive(created, wantActive, {
          deactivate: (v) => svc.deactivate(ctx.actor, created.id, v),
          reactivate: (v) => svc.reactivate(ctx.actor, created.id, v),
        });
        return ok('create', null, activation);
      }
      let current = svc.get(ctx.actor, found.id);
      const patch = {
        ...(current.name !== name ? { name } : {}),
        ...(current.municipalityCode !== municipalityCode ? { municipalityCode } : {}),
      };
      const changed = Object.keys(patch).length > 0;
      if (changed) current = svc.update(ctx.actor, found.id, current.version, patch);
      const activation = applyActive(current, wantActive, {
        deactivate: (v) => svc.deactivate(ctx.actor, found.id, v),
        reactivate: (v) => svc.reactivate(ctx.actor, found.id, v),
      });
      return ok(changed ? 'update' : 'unchanged', found, activation);
    });
  },
};

/** Aviso da linha que só ligou às filiais do usuário um cadastro de fora do escopo. */
export const LINKED_OUTSIDE_SCOPE =
  'Cadastro existente fora das suas filiais: só o vínculo com as filiais foi feito; os dados não mudaram';

/** O ator enxerga o registro? `not_found` do serviço = fora do escopo. */
function getIfVisible<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') return null;
    throw err;
  }
}

export const sellerImporter: Importer = {
  keyOf: (row) => row.get('codigo') || null,
  apply(ctx, unit) {
    const row = unit.rows[0] as Row;
    return single(row, (): RowResult => {
      const svc = ctx.services.sellers;
      const c = code(row, 'codigo');
      const name = clean(required(row, 'nome'));
      const branchIds = branchIdsByCodes(ctx.db, codeList(row, 'filiais', { required: true }), 'filiais');
      const wantActive = active(row);
      const found = findByCode(ctx.db, sellers, c) ?? null;
      assertUnchangedSinceValidation(ctx, row.line, found);
      if (!found) {
        const created = svc.create(ctx.actor, { code: c, name, branchIds });
        const activation = applyActive(created, wantActive, {
          deactivate: (v) => svc.deactivate(ctx.actor, created.id, v),
          reactivate: (v) => svc.reactivate(ctx.actor, created.id, v),
        });
        return ok('create', null, activation);
      }
      let current = getIfVisible(() => svc.get(ctx.actor, found.id));
      if (!current) {
        for (const b of branchIds) svc.linkSellerToBranchByCode(ctx.actor, c, b);
        return ok('linked', found, null, LINKED_OUTSIDE_SCOPE);
      }
      const patch = {
        ...(current.name !== name ? { name } : {}),
        ...(sameSet(
          current.branches.map((b) => b.id),
          branchIds,
        )
          ? {}
          : { branchIds }),
      };
      const changed = Object.keys(patch).length > 0;
      if (changed) current = svc.update(ctx.actor, found.id, current.version, patch);
      const activation = applyActive(current, wantActive, {
        deactivate: (v) => svc.deactivate(ctx.actor, found.id, v),
        reactivate: (v) => svc.reactivate(ctx.actor, found.id, v),
      });
      return ok(changed ? 'update' : 'unchanged', found, activation);
    });
  },
};

function cnpjOf(row: Row): string {
  const cnpj = normalizeCnpj(required(row, 'cnpj'));
  if (!isValidCnpj(cnpj)) throw invalid('CNPJ inválido');
  return cnpj;
}

/** CNPJ normalizado e válido, ou `null` (a linha falha depois com a mensagem certa). */
export function cnpjKey(row: Row): string | null {
  const cnpj = normalizeCnpj(row.get('cnpj'));
  return isValidCnpj(cnpj) ? cnpj : null;
}

export const customerImporter: Importer = {
  keyOf: cnpjKey,
  apply(ctx, unit) {
    const row = unit.rows[0] as Row;
    return single(row, (): RowResult => {
      const svc = ctx.services.customers;
      const cnpj = cnpjOf(row);
      const branchIds = branchIdsByCodes(ctx.db, codeList(row, 'filiais', { required: true }), 'filiais');
      const found =
        ctx.db
          .select({ id: customers.id, version: customers.version })
          .from(customers)
          .where(eq(customers.cnpj, cnpj))
          .get() ?? null;
      assertUnchangedSinceValidation(ctx, row.line, found);
      const data = {
        legalName: clean(required(row, 'razao_social')),
        tradeName: cleanOptionalText(row.get('nome_fantasia')),
        municipalityCode: integer(row, 'municipio_ibge'),
        neighborhood: clean(required(row, 'bairro')),
        retailNetworkId: refId(ctx.db, retailNetworks, optionalCode(row, 'rede_codigo'), 'rede_codigo'),
        economicGroupId: refId(
          ctx.db,
          economicGroups,
          optionalCode(row, 'grupo_economico_codigo'),
          'grupo_economico_codigo',
        ),
      };
      const wantActive = active(row);
      if (!found) {
        const created = svc.create(ctx.actor, { cnpj, ...data, branchIds });
        const activation = applyActive(created, wantActive, {
          deactivate: (v) => svc.deactivate(ctx.actor, created.id, v),
          reactivate: (v) => svc.reactivate(ctx.actor, created.id, v),
        });
        return ok('create', null, activation);
      }
      let current: CustomerResponse | null = getIfVisible(() => svc.get(ctx.actor, found.id));
      if (!current) {
        for (const b of branchIds) svc.linkCustomerToBranchByCnpj(ctx.actor, cnpj, b);
        return ok('linked', found, null, LINKED_OUTSIDE_SCOPE);
      }
      const c = current;
      const patch = {
        ...(c.legalName !== data.legalName ? { legalName: data.legalName } : {}),
        ...(c.tradeName !== data.tradeName ? { tradeName: data.tradeName } : {}),
        ...(c.municipalityCode !== data.municipalityCode ? { municipalityCode: data.municipalityCode } : {}),
        ...(c.neighborhood !== data.neighborhood ? { neighborhood: data.neighborhood } : {}),
        ...(c.retailNetworkId !== data.retailNetworkId ? { retailNetworkId: data.retailNetworkId } : {}),
        ...(c.economicGroupId !== data.economicGroupId ? { economicGroupId: data.economicGroupId } : {}),
        ...(sameSet(
          c.branches.map((b) => b.id),
          branchIds,
        )
          ? {}
          : { branchIds }),
      };
      const changed = Object.keys(patch).length > 0;
      if (changed) current = svc.update(ctx.actor, found.id, c.version, patch);
      const activation = applyActive(current, wantActive, {
        deactivate: (v) => svc.deactivate(ctx.actor, found.id, v),
        reactivate: (v) => svc.reactivate(ctx.actor, found.id, v),
      });
      return ok(changed ? 'update' : 'unchanged', found, activation);
    });
  },
};
