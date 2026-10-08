import { Type, type Static } from '@sinclair/typebox';
import { IMPORT_JOB_STATUSES, IMPORT_LINE_STATUSES } from '../../db/schema.js';
import { ACTIVATIONS, ROW_ACTIONS } from './import/types.js';
import { LAYOUT_IDS } from './layouts.js';

/** Arquivo de importação: até 16 MB. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_LINES_LIMIT = 1000;

const Nullable = <T extends ReturnType<typeof Type.Integer>>(t: T) => Type.Union([t, Type.Null()]);
const literals = (values: readonly string[]) => Type.Union(values.map((v) => Type.Literal(v)));

export const LayoutIdSchema = literals(LAYOUT_IDS);

export const ImportJobResponseSchema = Type.Object({
  id: Type.Integer(),
  layout: LayoutIdSchema,
  status: literals(IMPORT_JOB_STATUSES),
  createdAt: Type.Integer(),
  updatedAt: Type.Integer(),
  fileSha256: Type.String({ description: 'SHA-256 do arquivo enviado (auditoria).' }),
  fileBytes: Type.Integer(),
  totalRows: Type.Integer({ description: 'Linhas de dados (sem o cabeçalho).' }),
  processedRows: Type.Integer({ description: 'Linhas já processadas na fase atual.' }),
  errorRows: Type.Integer({ description: 'Linhas com erro na fase atual.' }),
  counts: Type.Record(Type.String(), Type.Integer(), {
    description:
      'Contagens da fase atual: por ação (`create`, `update`, `unchanged`, `linked`), por ativação ' +
      '(`deactivate`, `reactivate`) e, nos vínculos, `linksEnded`, `linksTakenOver` e `portfoliosFinalized`.',
  }),
  fileError: Type.Union([
    Type.Object({ message: Type.String(), line: Nullable(Type.Integer()) }),
    Type.Null(),
  ]),
  validatedAt: Nullable(Type.Integer()),
  expiresAt: Nullable(Type.Integer({ description: 'Prazo para confirmar a simulação (epoch ms).' })),
  confirmedAt: Nullable(Type.Integer()),
  finishedAt: Nullable(Type.Integer()),
});
export type ImportJobResponse = Static<typeof ImportJobResponseSchema>;

export const ImportLineResponseSchema = Type.Object({
  line: Type.Integer({ description: 'Linha do arquivo (o cabeçalho é a linha 1).' }),
  status: literals(IMPORT_LINE_STATUSES),
  action: Type.Union([literals(ROW_ACTIONS), Type.Null()]),
  activation: Type.Union([literals(ACTIVATIONS), Type.Null()]),
  errorCode: Type.Union([Type.String(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
  warning: Type.Union([Type.String(), Type.Null()]),
});
export type ImportLineResponse = Static<typeof ImportLineResponseSchema>;

export const ImportJobListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);
export type ImportJobListParams = Static<typeof ImportJobListQuerySchema>;

export const ImportLineListQuerySchema = Type.Object(
  {
    status: Type.Optional(literals(IMPORT_LINE_STATUSES)),
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LINES_LIMIT })),
  },
  { additionalProperties: false },
);
export type ImportLineListParams = Static<typeof ImportLineListQuerySchema>;
