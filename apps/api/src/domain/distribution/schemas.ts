import { Type, type Static } from '@sinclair/typebox';
import { MAX_LIMIT } from '../shared/pagination.js';

/** Itens por chamada de `PUT /assignments` (set + clear somados). */
export const MAX_ASSIGNMENT_ITEMS = 5000;

const Id = Type.Integer({ minimum: 1 });

export const ASSIGNMENT_STATUSES = ['assigned', 'unassigned', 'stale'] as const;

export const AssignmentListQuerySchema = Type.Object(
  {
    productSubgroupId: Type.Optional(Id),
    sellerId: Type.Optional(Id),
    status: Type.Optional(Type.Union(ASSIGNMENT_STATUSES.map((s) => Type.Literal(s)))),
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT })),
  },
  { additionalProperties: false },
);
export type AssignmentListParams = Static<typeof AssignmentListQuerySchema>;

export const ReplaceAssignmentsSchema = Type.Object(
  {
    set: Type.Optional(
      Type.Array(
        Type.Object({ customerId: Id, productSubgroupId: Id, sellerId: Id }, { additionalProperties: false }),
        { maxItems: MAX_ASSIGNMENT_ITEMS },
      ),
    ),
    clear: Type.Optional(
      Type.Array(Type.Object({ customerId: Id, productSubgroupId: Id }, { additionalProperties: false }), {
        maxItems: MAX_ASSIGNMENT_ITEMS,
      }),
    ),
  },
  { additionalProperties: false },
);
export type ReplaceAssignmentsInput = Static<typeof ReplaceAssignmentsSchema>;

export const DistributeSchema = Type.Object(
  {
    productSubgroupIds: Type.Optional(Type.Array(Id, { minItems: 1, maxItems: 1000 })),
  },
  { additionalProperties: false },
);
export type DistributeInput = Static<typeof DistributeSchema>;

export interface AssignmentItem {
  customer: { id: number; cnpj: string; legalName: string };
  productSubgroup: { id: number; code: string; name: string };
  /** Vendedor gravado (também em `stale`); null em `unassigned`. */
  seller: { id: number; code: string; name: string } | null;
  status: 'assigned' | 'unassigned' | 'stale';
}

export interface AssignmentPage {
  items: AssignmentItem[];
  nextCursor: string | null;
  /** Células que casam os filtros (não só a página). */
  total: number;
}

export interface SubgroupSummary {
  productSubgroup: { id: number; code: string; name: string };
  /** Todos os vendedores do subgrupo na carteira (contagem 0 inclusive), por código. */
  sellers: { seller: { id: number; code: string; name: string }; count: number }[];
  unassigned: number;
  stale: number;
}

export interface AssignmentSummary {
  subgroups: SubgroupSummary[];
  /** `stale` inclui as gravadas em subgrupos que saíram da carteira (sem linha em `subgroups`). */
  totals: { members: number; cells: number; assigned: number; unassigned: number; stale: number };
}
