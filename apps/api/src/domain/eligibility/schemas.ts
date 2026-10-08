import { Type, type Static } from '@sinclair/typebox';
import { MAX_LIMIT } from '../shared/pagination.js';

/** Teto de ajustes manuais por carteira (inclusões + exclusões). */
export const MAX_OVERRIDES = 5000;

const Id = Type.Integer({ minimum: 1 });

export const PreviewQuerySchema = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: 100 })),
    source: Type.Optional(Type.Union([Type.Literal('filter'), Type.Literal('manual')])),
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT })),
  },
  { additionalProperties: false },
);
export type PreviewQuery = Static<typeof PreviewQuerySchema>;

/** Substitui o conjunto de ajustes manuais. Um cliente não pode estar nas duas listas. */
export const ReplaceOverridesSchema = Type.Object(
  {
    include: Type.Array(Id, { maxItems: MAX_OVERRIDES }),
    exclude: Type.Array(Id, { maxItems: MAX_OVERRIDES }),
  },
  { additionalProperties: false },
);
export type ReplaceOverridesInput = Static<typeof ReplaceOverridesSchema>;

/** Só dado de empresa do cliente (nada de pessoa física). */
export const PreviewCustomerSchema = Type.Object({
  id: Type.Integer(),
  cnpj: Type.String(),
  legalName: Type.String(),
  tradeName: Type.Union([Type.String(), Type.Null()]),
  stateCode: Type.Integer(),
  municipalityCode: Type.Integer(),
  municipalityName: Type.String(),
  neighborhood: Type.String(),
});
export type PreviewCustomer = Static<typeof PreviewCustomerSchema>;

export const PreviewItemSchema = Type.Object({
  customer: PreviewCustomerSchema,
  source: Type.Union([Type.Literal('filter'), Type.Literal('manual')]),
  matchedRegionLevel: Type.Union([
    Type.Literal('state'),
    Type.Literal('municipality'),
    Type.Literal('neighborhood'),
    Type.Null(),
  ]),
  matchedBy: Type.Object({
    region: Type.Boolean(),
    retailNetwork: Type.Boolean(),
    economicGroup: Type.Boolean(),
  }),
});

export const PreviewResponseSchema = Type.Object({
  items: Type.Array(PreviewItemSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
  total: Type.Integer(),
});
export type PreviewResponse = Static<typeof PreviewResponseSchema>;

const OverrideEntry = Type.Object({
  customer: PreviewCustomerSchema,
  effective: Type.Boolean({
    description:
      'Inclusão: cliente ativo com vínculo ativo na filial. Exclusão: o cliente casaria pelos filtros hoje.',
  }),
});

export const OverridesResponseSchema = Type.Object({
  include: Type.Array(OverrideEntry),
  exclude: Type.Array(OverrideEntry),
});
export type OverridesResponse = Static<typeof OverridesResponseSchema>;
