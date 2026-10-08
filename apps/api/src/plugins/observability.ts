import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyError, FastifyInstance, FastifyServerOptions } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config.js';

export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Destino de log injetável (uso em testes): qualquer coisa com `write(string)`. */
export interface LogStream {
  write(chunk: string): void;
}

// Aceita o id do cliente só se for seguro (evita injeção em log e valores gigantes); senão gera um.
export function genReqId(req: IncomingMessage): string {
  const header = req.headers[REQUEST_ID_HEADER];
  return typeof header === 'string' && SAFE_REQUEST_ID.test(header) ? header : randomUUID();
}

// Caminhos redigidos (LGPD): credenciais e identificadores pessoais nunca vão para o log.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.token',
  '*.password',
  '*.cpf',
  '*.email',
  // Cinto de segurança: o Drizzle anexa `query`/`params` (valores de SQL) aos erros de banco.
  '*.params',
  '*.query',
  'err.query',
  'err.params',
];

// O CNPJ de cliente viaja no path (`/by-cnpj/{cnpj}/...`) e o código de vendedor em `/by-code/{code}/...`.
// No log tudo após o marcador é mascarado (inclusive o sufixo, se a barra do CNPJ vier sem codificar),
// e a query string é descartada.
export function safePath(url: string | undefined): string | undefined {
  return url
    ?.split('?')[0]
    ?.replace(/\/by-cnpj\/.*$/i, '/by-cnpj/:cnpj/...')
    .replace(/\/by-code\/.*$/i, '/by-code/:code/...');
}

// Só campos seguros de um erro 5xx. Nunca `message`, `query`, `params` nem `cause.message`: o
// `DrizzleQueryError` embute o SQL e os parâmetros (CNPJ, nomes) na mensagem. A stack entra só com os
// frames (`    at ...`): a primeira linha (e qualquer continuação) repete a mensagem e é descartada.
export function safeError(error: unknown): Record<string, unknown> {
  const e = (error ?? {}) as { name?: unknown; code?: unknown; stack?: unknown; cause?: unknown };
  const cause = (e.cause ?? undefined) as { name?: unknown; code?: unknown } | undefined;
  const frames =
    typeof e.stack === 'string'
      ? e.stack
          .split('\n')
          .filter((l) => /^\s+at /.test(l))
          .join('\n')
      : undefined;
  return {
    name: e.name,
    code: e.code,
    ...(cause ? { causeName: cause.name, causeCode: cause.code } : {}),
    stack: frames,
  };
}

// Configuração do logger do Fastify: JSON estruturado, serializers enxutos e redact.
export function buildLoggerOptions(
  config: Pick<AppConfig, 'LOG_LEVEL'>,
  stream?: LogStream,
): FastifyServerOptions['logger'] {
  if (config.LOG_LEVEL === 'silent' && !stream) return false;
  return {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      // Sem headers, sem corpo e sem query string (pode carregar token/PII).
      req: (req: { method?: string; url?: string }) => ({
        method: req.method,
        url: safePath(req.url),
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
    ...(stream ? { stream } : {}),
  };
}

export const observabilityPlugin = fp(
  async (app: FastifyInstance) => {
    // Ecoa o id em toda resposta (inclusive 401/503/404 e erros), pois onRequest roda antes de tudo.
    app.addHook('onRequest', async (request, reply) => {
      void reply.header(REQUEST_ID_HEADER, request.id);
    });

    // 404 próprio: o log padrão do Fastify ("Route ... not found") traz a URL com query string.
    // Aqui só método e caminho (sem query) vão para o log, e a resposta não ecoa a URL.
    app.setNotFoundHandler((request, reply) => {
      request.log.info({ method: request.method, path: safePath(request.url) }, 'Rota não encontrada');
      return reply.code(404).send({ error: 'not_found' });
    });

    app.setErrorHandler((error: FastifyError, request, reply) => {
      const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
      if (status >= 500) {
        // Só campos seguros vão para o log (ver safeError); a resposta é genérica.
        request.log.error({ err: safeError(error) }, 'Erro interno');
        return reply.code(status).send({ error: 'internal_error' });
      }
      request.log.warn({ code: error.code, status }, 'Requisição rejeitada');
      if (error.validation) {
        // Mensagens do validador citam o campo/regra, não o valor enviado.
        return reply.code(status).send({ error: 'validation_error', message: error.message });
      }
      return reply.code(status).send({ error: 'bad_request' });
    });
  },
  { name: 'observability' },
);
