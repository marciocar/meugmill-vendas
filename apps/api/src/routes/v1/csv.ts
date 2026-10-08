import { Readable } from 'node:stream';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { createExportService, type ExportService } from '../../domain/csv/export.js';
import { createImportJobService, type ImportJobService } from '../../domain/csv/jobs.js';
import { LAYOUT_IDS, LAYOUTS, type LayoutId } from '../../domain/csv/layouts.js';
import {
  ImportJobListQuerySchema,
  ImportJobResponseSchema,
  ImportLineListQuerySchema,
  ImportLineResponseSchema,
  LayoutIdSchema,
  MAX_FILE_BYTES,
  type ImportJobListParams,
  type ImportLineListParams,
} from '../../domain/csv/schemas.js';
import { PageSchema } from '../../domain/shared/pagination.js';
import { actorOf, ERROR_RESPONSES, IdParamsSchema, sendDomainError, serviceOptions } from './http.js';

const tags = ['csv'];

const ColumnSchema = Type.Object({
  name: Type.String(),
  type: Type.Union(['text', 'code', 'cnpj', 'integer', 'boolean', 'list'].map((t) => Type.Literal(t))),
  required: Type.Boolean(),
  readOnly: Type.Optional(Type.Boolean()),
  description: Type.String(),
  example: Type.String(),
});
const LayoutSchema = Type.Object({
  id: LayoutIdSchema,
  title: Type.String(),
  description: Type.String(),
  key: Type.Array(Type.String()),
  columns: Type.Array(ColumnSchema),
});
const FORMAT =
  'UTF-8 (BOM opcional na entrada; sempre com BOM na saída), separador `;`, aspas `"`, cabeçalho na 1ª linha, ' +
  'listas com `|`, booleano `S`/`N`.';
const LayoutsSchema = Type.Object({ format: Type.String(), layouts: Type.Array(LayoutSchema) });
const LayoutParamsSchema = Type.Object({ layout: LayoutIdSchema });
const ImportQuerySchema = Type.Object({ layout: LayoutIdSchema }, { additionalProperties: false });

export function registerCsvRoutes(
  app: FastifyInstance,
  opts: { jobs: ImportJobService; exports: ExportService },
): void {
  const { jobs, exports } = opts;
  const onRequest = app.authenticate;
  const idOf = (request: { params: unknown }) => (request.params as { id: number }).id;

  app.get(
    '/csv-layouts',
    { onRequest, schema: { tags, response: { 200: LayoutsSchema, ...ERROR_RESPONSES } } },
    async () => ({ format: FORMAT, layouts: LAYOUT_IDS.map((id) => LAYOUTS[id]) }),
  );

  app.get(
    '/csv-layouts/:layout',
    {
      onRequest,
      schema: { tags, params: LayoutParamsSchema, response: { 200: LayoutSchema, ...ERROR_RESPONSES } },
    },
    async (request) => LAYOUTS[(request.params as { layout: LayoutId }).layout],
  );

  // Envio do arquivo num escopo próprio: só aqui vale o parser `text/csv` com limite de 16 MB, e o perfil é
  // conferido no `onRequest`, ANTES de ler o corpo (quem não pode importar não faz a API guardar 16 MB).
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      'text/csv',
      { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES },
      (_req, body, done) => done(null, body),
    );
    scope.post(
      '/imports',
      {
        onRequest: [
          app.authenticate,
          async (request, reply) => {
            try {
              jobs.assertCanImport(actorOf(request));
            } catch (err) {
              return sendDomainError(reply, err);
            }
          },
        ],
        bodyLimit: MAX_FILE_BYTES,
        schema: {
          tags,
          description:
            'Envia um CSV (`Content-Type: text/csv`, até 16 MB e 100 mil linhas) e agenda a simulação. ' +
            'Responde 202 com o job em `validating`; acompanhe por `GET /v1/imports/{id}`.',
          querystring: ImportQuerySchema,
          response: { 202: ImportJobResponseSchema, ...ERROR_RESPONSES },
        },
      },
      async (request, reply) => {
        try {
          if (!Buffer.isBuffer(request.body)) {
            return await reply
              .code(400)
              .send({ error: 'validation_error', message: 'Envie o arquivo como text/csv' });
          }
          const job = jobs.submit(
            actorOf(request),
            (request.query as { layout: string }).layout,
            request.body,
          );
          return await reply.code(202).send(job);
        } catch (err) {
          return sendDomainError(reply, err);
        }
      },
    );
  });

  app.get(
    '/imports',
    {
      onRequest,
      schema: {
        tags,
        querystring: ImportJobListQuerySchema,
        response: { 200: PageSchema(ImportJobResponseSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return jobs.list(actorOf(request), request.query as ImportJobListParams);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get(
    '/imports/:id',
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        response: { 200: ImportJobResponseSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return jobs.get(actorOf(request), idOf(request));
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get(
    '/imports/:id/lines',
    {
      onRequest,
      schema: {
        tags,
        description:
          'Relatório por linha (ação prevista ou gravada, ou o erro com a mensagem fixa do domínio).',
        params: IdParamsSchema,
        querystring: ImportLineListQuerySchema,
        response: { 200: PageSchema(ImportLineResponseSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return jobs.lines(actorOf(request), idOf(request), request.query as ImportLineListParams);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.post(
    '/imports/:id/confirm',
    {
      onRequest,
      schema: {
        tags,
        description:
          'Confirma uma simulação `validated` sem erros e agenda a gravação (202). Linha cujo registro mudou ' +
          'depois da simulação falha com `version_conflict`.',
        params: IdParamsSchema,
        response: { 202: ImportJobResponseSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return await reply.code(202).send(jobs.confirm(actorOf(request), idOf(request)));
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.post(
    '/imports/:id/cancel',
    {
      onRequest,
      schema: {
        tags,
        params: IdParamsSchema,
        response: { 200: ImportJobResponseSchema, ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        return jobs.cancel(actorOf(request), idOf(request));
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get(
    '/exports/:layout',
    {
      onRequest,
      schema: {
        tags,
        description:
          'CSV no mesmo layout da importação, com o escopo e a visibilidade do usuário (E2–E8). Reimportar o ' +
          'arquivo sem editar não muda nada.',
        params: LayoutParamsSchema,
        response: {
          200: { description: 'Arquivo CSV (`text/csv; charset=utf-8`, com BOM).', type: 'string' },
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      try {
        const { layout, chunks } = exports.open(
          actorOf(request),
          (request.params as { layout: string }).layout,
        );
        const date = new Date().toISOString().slice(0, 10);
        return await reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${layout}-${date}.csv"`)
          .header('cache-control', 'no-store')
          .send(Readable.from(chunks));
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );
}

/** Plugin: importação e exportação de CSV (E10). Um serviço de jobs (fila serial) por app. */
export async function csvRoutes(app: FastifyInstance): Promise<void> {
  const options = serviceOptions(app);
  const jobs = createImportJobService(app.db, {
    ...options,
    onJobError: (jobId, err) => {
      // Só o id do job e o tipo do erro: nada do arquivo.
      app.log.error({ jobId, errName: err instanceof Error ? err.name : typeof err }, 'import_job_failed');
    },
  });
  const recovered = jobs.recover();
  if (recovered > 0) {
    app.log.warn({ recovered }, 'import_jobs_recovered: jobs abertos perderam o arquivo na subida');
  }
  jobs.start();
  // Ao desligar, o job em curso para no próximo bloco (vira `interrupted`) em vez de segurar o processo.
  app.addHook('onClose', async () => {
    jobs.stop();
    await jobs.idle();
  });
  registerCsvRoutes(app, { jobs, exports: createExportService(app.db, options) });
}
