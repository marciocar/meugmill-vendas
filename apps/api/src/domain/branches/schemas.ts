import { Type, type Static } from '@sinclair/typebox';
import { AuditResponseFields } from '../shared/audit.js';

export const CreateBranchSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 32 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    municipalityCode: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type CreateBranchInput = Static<typeof CreateBranchSchema>;

/** O código da filial não muda (é o elo com as claims do token). */
export const UpdateBranchSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    municipalityCode: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type UpdateBranchInput = Static<typeof UpdateBranchSchema>;

export const BranchResponseSchema = Type.Object({
  id: Type.Integer(),
  code: Type.String(),
  name: Type.String(),
  municipalityCode: Type.Integer(),
  ...AuditResponseFields,
});
export type BranchResponse = Static<typeof BranchResponseSchema>;
