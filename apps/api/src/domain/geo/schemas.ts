import { Type, type Static } from '@sinclair/typebox';
import { MAX_LIMIT } from '../shared/pagination.js';

export const StateResponseSchema = Type.Object({
  ibgeCode: Type.Integer(),
  uf: Type.String(),
  name: Type.String(),
});
export type StateResponse = Static<typeof StateResponseSchema>;

export const MunicipalityResponseSchema = Type.Object({
  ibgeCode: Type.Integer(),
  name: Type.String(),
  stateCode: Type.Integer(),
  uf: Type.String(),
});
export type MunicipalityResponse = Static<typeof MunicipalityResponseSchema>;

export const MunicipalityQuerySchema = Type.Object(
  {
    uf: Type.Optional(Type.String({ minLength: 2, maxLength: 2 })),
    q: Type.Optional(Type.String({ maxLength: 100 })),
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT })),
  },
  { additionalProperties: false },
);
export type MunicipalityQuery = Static<typeof MunicipalityQuerySchema>;
