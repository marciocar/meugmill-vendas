import { Type, type Static } from '@sinclair/typebox';
import type { PortfolioResponse } from '../portfolios/schemas.js';
import { MAX_LIMIT } from '../shared/pagination.js';

const Id = Type.Integer({ minimum: 1 });

/** Limite máximo de eventos por leitura da outbox. */
export const MAX_EVENTS_LIMIT = 1000;
export const DEFAULT_EVENTS_LIMIT = 100;

export const LinkListQuerySchema = Type.Object(
  {
    productSubgroupId: Type.Optional(Id),
    sellerId: Type.Optional(Id),
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT })),
  },
  { additionalProperties: false },
);
export type LinkListParams = Static<typeof LinkListQuerySchema>;

export const LinkHistoryQuerySchema = Type.Object(
  {
    customerId: Type.Optional(Id),
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT })),
  },
  { additionalProperties: false },
);
export type LinkHistoryParams = Static<typeof LinkHistoryQuerySchema>;

export const LinkEventsQuerySchema = Type.Object(
  {
    branchId: Type.Optional(Id),
    after: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_EVENTS_LIMIT })),
  },
  { additionalProperties: false },
);
export type LinkEventsParams = Static<typeof LinkEventsQuerySchema>;

interface CodeRef {
  id: number;
  code: string;
  name: string;
}

export interface LinkItem {
  id: number;
  customer: { id: number; cnpj: string; legalName: string };
  productSubgroup: CodeRef;
  seller: CodeRef;
  active: boolean;
  validFrom: number;
  /** null enquanto o vínculo está ativo. */
  validTo: number | null;
}

export interface LinkPage {
  items: LinkItem[];
  nextCursor: string | null;
  /** Vínculos que casam os filtros (não só a página). */
  total: number;
}

export interface LinkHistoryPage {
  items: LinkItem[];
  nextCursor: string | null;
}

export interface LinkEventItem {
  id: number;
  kind: 'created' | 'ended';
  linkId: number;
  portfolioId: number;
  branch: { id: number; code: string };
  customer: { id: number; cnpj: string };
  productSubgroup: { id: number; code: string };
  seller: { id: number; code: string };
  occurredAt: number;
}

export interface LinkEventPage {
  items: LinkEventItem[];
  /** Id do último evento entregue (use como `after` na próxima leitura); null se a página veio vazia. */
  nextAfter: number | null;
  /** Há mais eventos além desta página. */
  hasMore: boolean;
}

export interface FinalizeResult {
  aggregate: PortfolioResponse;
  /** Vínculos criados (célula nova ou vendedor trocado). */
  created: number;
  /** Vínculos encerrados (célula saiu da grade ou vendedor trocado). */
  ended: number;
  /** Vínculos ativos preservados (mesmo vendedor). */
  kept: number;
}
