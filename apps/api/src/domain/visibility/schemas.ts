import { Type, type Static } from '@sinclair/typebox';
import { MAX_LIMIT } from '../shared/pagination.js';

const Id = Type.Integer({ minimum: 1 });
const ProfileSchema = Type.Union([
  Type.Literal('vendedor'),
  Type.Literal('gestor'),
  Type.Literal('admin'),
  Type.Literal('supervisao'),
]);
/** `legacy` só aparece em `via` quando o ator lê como antes do E8. */
const ViaProfileSchema = Type.Union([ProfileSchema, Type.Literal('legacy')]);

export const MAX_CHECK_IDS = 1000;

export const MyCustomersQuerySchema = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: 100 })),
    productSubgroupId: Type.Optional(Id),
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT })),
  },
  { additionalProperties: false },
);
export type MyCustomersParams = Static<typeof MyCustomersQuerySchema>;

/** Até 1.000 ids distintos; id inválido ou repetido é 400. */
export const CheckBodySchema = Type.Object(
  {
    customerIds: Type.Array(Id, { maxItems: MAX_CHECK_IDS, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type CheckInput = Static<typeof CheckBodySchema>;

export const ViaSchema = Type.Object({
  productSubgroupId: Type.Integer(),
  portfolioId: Type.Integer(),
  profile: ViaProfileSchema,
});

export const VisibleCustomerSchema = Type.Object({
  id: Type.Integer(),
  cnpj: Type.String(),
  legalName: Type.String(),
  tradeName: Type.Union([Type.String(), Type.Null()]),
  stateCode: Type.Integer(),
  municipalityCode: Type.Integer(),
  neighborhood: Type.String(),
  /** Pelo que o cliente é visível (vínculos ativos); vazio quando só a leitura ampla da filial o mostra. */
  via: Type.Array(ViaSchema),
});
export type VisibleCustomer = Static<typeof VisibleCustomerSchema>;

export const VisibleCustomersPageSchema = Type.Object({
  items: Type.Array(VisibleCustomerSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
  total: Type.Integer(),
});
export type VisibleCustomersPage = Static<typeof VisibleCustomersPageSchema>;

export const CheckResponseSchema = Type.Object({ visible: Type.Array(Type.Integer()) });
export type CheckResponse = Static<typeof CheckResponseSchema>;

export const VisibilitySummarySchema = Type.Object({
  profiles: Type.Array(ProfileSchema),
  mode: Type.Union([Type.Literal('profiles'), Type.Literal('legacy'), Type.Literal('denied')], {
    description:
      '`legacy`: sem perfil conhecido, lê a filial (VISIBILITY_LEGACY=allow). `denied`: sem perfil conhecido e VISIBILITY_LEGACY=deny, não lê nada amplo.',
  }),
  /** Vendedor ligado ao login (`sellers.user_sub`); null sem o perfil ou sem a ligação. */
  seller: Type.Union([Type.Object({ id: Type.Integer(), code: Type.String() }), Type.Null()]),
  /** Clientes visíveis (união de todos os perfis, sem repetir). */
  visibleCustomers: Type.Integer(),
  /** Clientes visíveis por cada perfil, isoladamente. */
  byProfile: Type.Record(Type.String(), Type.Integer()),
});
export type VisibilitySummary = Static<typeof VisibilitySummarySchema>;
