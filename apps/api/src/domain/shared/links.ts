import { Type } from '@sinclair/typebox';
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { assertAllInScope } from './authz.js';
import type { Conn } from './db.js';
import { invalid } from './errors.js';

export const BranchRefSchema = Type.Object({
  id: Type.Integer(),
  code: Type.String(),
  name: Type.String(),
});
export interface BranchRef {
  id: number;
  code: string;
  name: string;
}

/**
 * Repositório de uma tabela de vínculo N:N com `branches` (customer_branches / seller_branches).
 * Os nomes de tabela/coluna vêm de uma união fechada de literais (nunca de entrada externa),
 * então `sql.raw` é seguro; todos os valores vão como parâmetros.
 */
export interface LinkRepo {
  /** Cláusula "o dono tem vínculo com alguma filial do escopo". */
  visibleClause(ownerId: AnyColumn, scopeIds: number[]): SQL;
  branchIdsOf(conn: Conn, ownerId: number): number[];
  add(conn: Conn, ownerId: number, branchIds: number[]): void;
  remove(conn: Conn, ownerId: number, branchIds: number[]): void;
  /** Filiais de cada dono restritas ao escopo do ator (ordenadas por código). */
  scopedBranches(conn: Conn, ownerIds: number[], scopeIds: number[]): Map<number, BranchRef[]>;
}

function idList(ids: number[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

export function makeLinkRepo(
  tableName: 'customer_branches' | 'seller_branches',
  ownerColumn: 'customer_id' | 'seller_id',
): LinkRepo {
  const table = sql.raw(tableName);
  const owner = sql.raw(ownerColumn);
  return {
    visibleClause(ownerId, scopeIds) {
      if (scopeIds.length === 0) return sql`0 = 1`;
      return sql`${ownerId} in (select ${owner} from ${table} where branch_id in (${idList(scopeIds)}))`;
    },
    branchIdsOf(conn, ownerId) {
      return conn
        .all<{ branch_id: number }>(sql`select branch_id from ${table} where ${owner} = ${ownerId}`)
        .map((r) => r.branch_id);
    },
    add(conn, ownerId, branchIds) {
      for (const branchId of branchIds) {
        conn.run(sql`insert into ${table} (${owner}, branch_id) values (${ownerId}, ${branchId})`);
      }
    },
    remove(conn, ownerId, branchIds) {
      if (branchIds.length === 0) return;
      conn.run(sql`delete from ${table} where ${owner} = ${ownerId} and branch_id in (${idList(branchIds)})`);
    },
    scopedBranches(conn, ownerIds, scopeIds) {
      const out = new Map<number, BranchRef[]>();
      if (ownerIds.length === 0 || scopeIds.length === 0) return out;
      const rows = conn.all<{ owner_id: number; id: number; code: string; name: string }>(
        sql`select l.${owner} as owner_id, b.id as id, b.code as code, b.name as name
            from ${table} l join branches b on b.id = l.branch_id
            where l.${owner} in (${idList(ownerIds)}) and l.branch_id in (${idList(scopeIds)})
            order by b.code`,
      );
      for (const r of rows) {
        const list = out.get(r.owner_id) ?? [];
        list.push({ id: r.id, code: r.code, name: r.name });
        out.set(r.owner_id, list);
      }
      return out;
    },
  };
}

export const customerLinks = makeLinkRepo('customer_branches', 'customer_id');
export const sellerLinks = makeLinkRepo('seller_branches', 'seller_id');

export interface LinkPlan {
  toAdd: number[];
  toRemove: number[];
}

/** Toda filial a ligar precisa estar ativa (vincular a filial inativa não faz sentido). */
export function assertBranchesActive(conn: Conn, branchIds: number[]): void {
  if (branchIds.length === 0) return;
  const rows = conn.all<{ n: number }>(
    sql`select count(*) as n from branches where id in (${idList(branchIds)}) and active = 1`,
  );
  if ((rows[0]?.n ?? 0) !== branchIds.length) throw invalid('Filial inativa ou inexistente');
}

/**
 * Plano de alteração dos vínculos. `desired` é o conjunto desejado DENTRO do escopo do ator:
 * vínculos com filiais fora do escopo são preservados (o ator nem os enxerga). Toda filial
 * adicionada ou removida está, por construção, no escopo. O registro não pode ficar sem filial.
 */
export function planLinkChange(
  repo: LinkRepo,
  conn: Conn,
  ownerId: number,
  desired: number[],
  scopeIds: number[],
): LinkPlan {
  assertAllInScope(desired, scopeIds);
  const current = repo.branchIdsOf(conn, ownerId);
  const scope = new Set(scopeIds);
  const want = new Set(desired);
  const have = new Set(current);
  const toAdd = [...want].filter((id) => !have.has(id));
  const toRemove = current.filter((id) => scope.has(id) && !want.has(id));
  if (current.length - toRemove.length + toAdd.length < 1) {
    throw invalid('O registro precisa ter ao menos uma filial');
  }
  assertBranchesActive(conn, toAdd);
  return { toAdd, toRemove };
}
