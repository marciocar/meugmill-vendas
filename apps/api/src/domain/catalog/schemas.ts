import { Type, type Static } from '@sinclair/typebox';
import { AuditResponseFields } from '../shared/audit.js';

export const CreateCatalogSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 32 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
  },
  { additionalProperties: false },
);
export type CreateCatalogInput = Static<typeof CreateCatalogSchema>;

/** O código é identidade de negócio e não muda; só o nome. */
export const UpdateCatalogSchema = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 120 }) },
  { additionalProperties: false },
);
export type UpdateCatalogInput = Static<typeof UpdateCatalogSchema>;

export const CatalogResponseSchema = Type.Object({
  id: Type.Integer(),
  code: Type.String(),
  name: Type.String(),
  ...AuditResponseFields,
});
export type CatalogResponse = Static<typeof CatalogResponseSchema>;
