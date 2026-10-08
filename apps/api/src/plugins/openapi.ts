import swagger from '@fastify/swagger';
import type { FastifyInstance, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import { readFileSync } from 'node:fs';

/** Nome do security scheme (JWT Bearer) aplicado às rotas autenticadas. */
export const BEARER_AUTH = 'bearerAuth';

// src/plugins e dist/plugins ficam ambos a dois níveis do package.json do app.
function readVersion(): string {
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  const version = (JSON.parse(raw) as { version?: unknown }).version;
  return typeof version === 'string' ? version : '0.0.0';
}

function usesAuthenticate(app: FastifyInstance, route: RouteOptions): boolean {
  const hooks = [route.onRequest, route.preHandler].flat().filter(Boolean);
  return hooks.includes(app.authenticate);
}

/**
 * Gera o documento OpenAPI 3 a partir dos schemas TypeBox das rotas e o expõe em
 * `GET /v1/openapi.json` (sem autenticação e sem interface visual). Deve ser registrado ANTES das
 * rotas e depois do `authPlugin`: o hook `onRoute` marca com `bearerAuth` toda rota que usa
 * `app.authenticate`; `/health`, `/ready` e o próprio `/v1/openapi.json` ficam sem security.
 */
export const openapiPlugin = fp(async (app: FastifyInstance) => {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'MeuGmill Vendas — Carteira de Clientes API',
        version: readVersion(),
        description:
          'API REST dos dados mestres da carteira de clientes: clientes, vendedores, filiais, ' +
          'subgrupos de produto, redes de varejo, grupos econômicos e localidades IBGE.',
      },
      components: {
        securitySchemes: {
          [BEARER_AUTH]: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  app.addHook('onRoute', (route) => {
    if (!usesAuthenticate(app, route)) return;
    route.schema = { ...route.schema, security: [{ [BEARER_AUTH]: [] }] };
  });

  app.get('/v1/openapi.json', { schema: { hide: true } }, async () => app.swagger());
});
