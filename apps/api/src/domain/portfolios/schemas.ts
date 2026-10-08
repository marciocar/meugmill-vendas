import { Type, type Static } from '@sinclair/typebox';
import { AuditResponseFields } from '../shared/audit.js';
import { MAX_LIMIT } from '../shared/pagination.js';

export const MAX_REGIONS = 500;
export const MAX_NETWORKS = 200;
export const MAX_GROUPS = 200;
export const MAX_ASSIGNMENTS = 500;

const Id = Type.Integer({ minimum: 1 });
const Name = Type.String({ minLength: 1, maxLength: 120 });
const Description = Type.String({ maxLength: 1000 });
const ResponsibleSub = Type.String({ minLength: 1, maxLength: 255 });

/** Cria o rascunho: só as informações (etapa 1 do wizard). */
export const CreatePortfolioSchema = Type.Object(
  {
    name: Name,
    description: Type.Optional(Type.Union([Description, Type.Null()])),
    branchId: Id,
    responsibleSub: ResponsibleSub,
    portfolioTypeId: Id,
  },
  { additionalProperties: false },
);
export type CreatePortfolioInput = Static<typeof CreatePortfolioSchema>;

/** Trocar `branchId` ou `responsibleSub` é só do admin. `description: null` limpa o texto. */
export const UpdatePortfolioSchema = Type.Object(
  {
    name: Type.Optional(Name),
    description: Type.Optional(Type.Union([Description, Type.Null()])),
    branchId: Type.Optional(Id),
    responsibleSub: Type.Optional(ResponsibleSub),
    portfolioTypeId: Type.Optional(Id),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type UpdatePortfolioInput = Static<typeof UpdatePortfolioSchema>;

export const REGION_LEVELS = ['state', 'municipality', 'neighborhood'] as const;

/**
 * Entrada de região. `state`: só `stateCode`; `municipality`: + `municipalityCode`;
 * `neighborhood`: + `municipalityCode` e `neighborhoodLabel`.
 */
export const RegionInputSchema = Type.Object(
  {
    level: Type.Union(REGION_LEVELS.map((l) => Type.Literal(l))),
    stateCode: Id,
    municipalityCode: Type.Optional(Id),
    neighborhoodLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  },
  { additionalProperties: false },
);
export type RegionInput = Static<typeof RegionInputSchema>;

/** Substitui o conjunto inteiro de filtros; vazio limpa a seção. */
export const ReplaceFiltersSchema = Type.Object(
  {
    regions: Type.Array(RegionInputSchema, { maxItems: MAX_REGIONS }),
    retailNetworkIds: Type.Array(Id, { maxItems: MAX_NETWORKS }),
    economicGroupIds: Type.Array(Id, { maxItems: MAX_GROUPS }),
  },
  { additionalProperties: false },
);
export type ReplaceFiltersInput = Static<typeof ReplaceFiltersSchema>;

export const ReplaceSellersSchema = Type.Object(
  {
    assignments: Type.Array(
      Type.Object({ sellerId: Id, productSubgroupId: Id }, { additionalProperties: false }),
      { maxItems: MAX_ASSIGNMENTS },
    ),
  },
  { additionalProperties: false },
);
export type ReplaceSellersInput = Static<typeof ReplaceSellersSchema>;

export const PortfolioListQuerySchema = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: 100 })),
    branchId: Type.Optional(Id),
    status: Type.Optional(Type.Union([Type.Literal('draft'), Type.Literal('active')])),
    active: Type.Optional(Type.Boolean()),
    responsibleSub: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT })),
  },
  { additionalProperties: false },
);
export type PortfolioListParams = Static<typeof PortfolioListQuerySchema>;

const BranchRef = Type.Object({ id: Type.Integer(), code: Type.String(), name: Type.String() });
const CodeRef = Type.Object({ id: Type.Integer(), code: Type.String(), name: Type.String() });
const STATUS = Type.Union([Type.Literal('draft'), Type.Literal('active')]);

export const RegionResponseSchema = Type.Object({
  level: Type.Union(REGION_LEVELS.map((l) => Type.Literal(l))),
  stateCode: Type.Integer(),
  uf: Type.String(),
  municipalityCode: Type.Optional(Type.Integer()),
  municipalityName: Type.Optional(Type.String()),
  neighborhoodKey: Type.Optional(Type.String()),
  neighborhoodLabel: Type.Optional(Type.String()),
});
export type RegionResponse = Static<typeof RegionResponseSchema>;

/** Agregado completo (o resumo do wizard). O responsável sai só como `responsibleSub`. */
export const PortfolioResponseSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  branch: BranchRef,
  type: CodeRef,
  responsibleSub: Type.String(),
  status: STATUS,
  filters: Type.Object({
    regions: Type.Array(RegionResponseSchema),
    retailNetworks: Type.Array(CodeRef),
    economicGroups: Type.Array(CodeRef),
  }),
  sellers: Type.Array(Type.Object({ seller: CodeRef, productSubgroup: CodeRef })),
  overridesInclude: Type.Integer({ description: 'Clientes incluídos manualmente na prévia.' }),
  overridesExclude: Type.Integer({ description: 'Clientes excluídos manualmente da prévia.' }),
  conflictsBlocked: Type.Optional(
    Type.Integer({
      description:
        'Clientes desta carteira em empate de posto com outra da filial (bloqueados). Só com `include=conflicts`.',
    }),
  ),
  conflictsLost: Type.Optional(
    Type.Integer({
      description:
        'Clientes desta carteira em que outra da filial tem posto maior. Só com `include=conflicts`.',
    }),
  ),
  ...AuditResponseFields,
});
export type PortfolioResponse = Static<typeof PortfolioResponseSchema>;

/** Dados opcionais do agregado, sob demanda (as contagens de conflito resolvem a disputa inteira). */
export const PortfolioGetQuerySchema = Type.Object(
  {
    include: Type.Optional(
      Type.Literal('conflicts', {
        description: 'Acrescenta `conflictsBlocked` e `conflictsLost` (mais lento: resolve a disputa).',
      }),
    ),
  },
  { additionalProperties: false },
);
export type PortfolioInclude = NonNullable<Static<typeof PortfolioGetQuerySchema>['include']>;

export const PortfolioListItemSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  branch: BranchRef,
  type: CodeRef,
  status: STATUS,
  active: Type.Boolean(),
  responsibleSub: Type.String(),
  regionsCount: Type.Integer(),
  retailNetworksCount: Type.Integer(),
  economicGroupsCount: Type.Integer(),
  sellersCount: Type.Integer({ description: 'Vendedores distintos.' }),
  version: Type.Integer(),
});
export type PortfolioListItem = Static<typeof PortfolioListItemSchema>;
