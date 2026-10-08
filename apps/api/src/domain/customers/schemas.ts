import { Type, type Static } from '@sinclair/typebox';
import { AuditResponseFields } from '../shared/audit.js';
import { BranchRefSchema } from '../shared/links.js';

const NullableId = Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]);
const NullableName = Type.Union([Type.String({ maxLength: 200 }), Type.Null()]);

/**
 * `cnpj` aceita máscara e minúsculas (é normalizado para 14 posições e validado no service; numérico ou alfanumérico).
 * `stateCode` é o código IBGE da UF; se omitido, deriva-se do município.
 */
export const CreateCustomerSchema = Type.Object(
  {
    cnpj: Type.String({ minLength: 14, maxLength: 18 }),
    legalName: Type.String({ minLength: 1, maxLength: 200 }),
    tradeName: Type.Optional(NullableName),
    stateCode: Type.Optional(Type.Integer({ minimum: 1 })),
    municipalityCode: Type.Integer({ minimum: 1 }),
    neighborhood: Type.String({ minLength: 1, maxLength: 100 }),
    retailNetworkId: Type.Optional(NullableId),
    economicGroupId: Type.Optional(NullableId),
    branchIds: Type.Array(Type.Integer({ minimum: 1 }), {
      minItems: 1,
      maxItems: 200,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
export type CreateCustomerInput = Static<typeof CreateCustomerSchema>;

/**
 * O CNPJ não muda. `branchIds` é o conjunto desejado de filiais DO ESCOPO do ator; vínculos
 * com filiais fora do escopo são preservados. `null` limpa trade name, rede e grupo.
 */
export const UpdateCustomerSchema = Type.Object(
  {
    legalName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    tradeName: Type.Optional(NullableName),
    stateCode: Type.Optional(Type.Integer({ minimum: 1 })),
    municipalityCode: Type.Optional(Type.Integer({ minimum: 1 })),
    neighborhood: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    retailNetworkId: Type.Optional(NullableId),
    economicGroupId: Type.Optional(NullableId),
    branchIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 200, uniqueItems: true })),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type UpdateCustomerInput = Static<typeof UpdateCustomerSchema>;

export const CustomerResponseSchema = Type.Object({
  id: Type.Integer(),
  cnpj: Type.String(),
  legalName: Type.String(),
  tradeName: Type.Union([Type.String(), Type.Null()]),
  stateCode: Type.Integer(),
  municipalityCode: Type.Integer(),
  neighborhood: Type.String(),
  neighborhoodKey: Type.String(),
  retailNetworkId: Type.Union([Type.Integer(), Type.Null()]),
  economicGroupId: Type.Union([Type.Integer(), Type.Null()]),
  /** Apenas as filiais do escopo do ator. */
  branches: Type.Array(BranchRefSchema),
  ...AuditResponseFields,
});
export type CustomerResponse = Static<typeof CustomerResponseSchema>;
