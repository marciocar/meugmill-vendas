import { Type, type Static } from '@sinclair/typebox';
import { AuditResponseFields } from '../shared/audit.js';
import { BranchRefSchema } from '../shared/links.js';

/** `sub` do login (opaco, sem dado pessoal). Vazio ou null desliga a ligação (E8). */
const UserSub = Type.Union([Type.String({ maxLength: 200 }), Type.Null()]);

const BranchIds = Type.Array(Type.Integer({ minimum: 1 }), {
  minItems: 1,
  maxItems: 200,
  uniqueItems: true,
});

/** Minimização (LGPD): só código e nome; sem e-mail, telefone ou documento. */
export const CreateSellerSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 32 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    branchIds: BranchIds,
    userSub: Type.Optional(UserSub),
  },
  { additionalProperties: false },
);
export type CreateSellerInput = Static<typeof CreateSellerSchema>;

/**
 * `branchIds` é o conjunto desejado de filiais DO ESCOPO do ator (as que ele enxerga);
 * vínculos com filiais fora do escopo são preservados. Pode ser `[]` desde que o vendedor
 * continue com ao menos uma filial.
 */
export const UpdateSellerSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    userSub: Type.Optional(UserSub),
    branchIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 200, uniqueItems: true })),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type UpdateSellerInput = Static<typeof UpdateSellerSchema>;

export const SellerResponseSchema = Type.Object({
  id: Type.Integer(),
  code: Type.String(),
  name: Type.String(),
  /** Apenas as filiais do escopo do ator. */
  branches: Type.Array(BranchRefSchema),
  /**
   * `sub` do login ligado ao vendedor. Só o admin recebe o campo (minimização): para os demais perfis
   * ele é omitido, não `null`, para não revelar nem a existência da ligação.
   */
  userSub: Type.Optional(UserSub),
  ...AuditResponseFields,
});
export type SellerResponse = Static<typeof SellerResponseSchema>;
