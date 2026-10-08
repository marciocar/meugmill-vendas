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

/**
 * Grupos da referência da API (as tags do OpenAPI), na ordem de leitura. A rota cai no PRIMEIRO grupo cujo
 * padrão casa a URL: os mais específicos (sub-rotas da carteira) vêm antes de `/v1/portfolios`.
 */
export const TAGS: { name: string; description: string; match: RegExp }[] = [
  {
    name: 'Usuário e visibilidade',
    description: 'Quem está logado e quais clientes cada perfil enxerga (E8).',
    match: /^\/v1\/(me|visibility)\b/,
  },
  {
    name: 'Elegibilidade e ajustes',
    description:
      'Prévia dos clientes que a carteira alcança, disputa entre carteiras e inclusões e exclusões manuais (E4/E5).',
    match: /^\/v1\/portfolios\/:id\/(preview|overrides)\b/,
  },
  {
    name: 'Distribuição',
    description:
      'Quem atende cada cliente em cada subgrupo: grade, resumo, edição manual e distribuição automática (E6).',
    match: /^\/v1\/portfolios\/:id\/(assignments|distribute)\b/,
  },
  {
    name: 'Vínculos',
    description:
      'Finalizar a carteira, vínculos ativos, histórico e a outbox de eventos para o sistema principal (E7).',
    match: /^\/v1\/(portfolios\/:id\/(finalize|links)|link-events)\b/,
  },
  {
    name: 'Carteiras',
    description: 'O agregado da carteira (etapas 1 a 4 do wizard) e os tipos de carteira (E3).',
    match: /^\/v1\/portfolio(s|-types)\b/,
  },
  {
    name: 'Importação e exportação CSV',
    description: 'Layouts, envio com simulação, relatório por linha, confirmação e exportação (E10).',
    match: /^\/v1\/(imports|exports|csv-layouts)\b/,
  },
  {
    name: 'Dados mestres',
    description: 'Filiais, vendedores, clientes, subgrupos de produto, redes e grupos econômicos (E2).',
    match: /^\/v1\/(branches|sellers|customers|product-subgroups|retail-networks|economic-groups)\b/,
  },
  {
    name: 'Localidades (IBGE)',
    description: 'Estados e municípios, para os filtros de região.',
    match: /^\/v1\/geo\b/,
  },
  {
    name: 'Saúde',
    description: 'Sondas de vida e prontidão, sem autenticação.',
    match: /^\/(health|ready)$/,
  },
];

const DESCRIPTION = [
  'API REST da **Carteira de Clientes** do MeuGmill Vendas: quem atende cada farmácia, filial por filial.',
  '',
  '- **Autenticação**: JWT do usuário em `Authorization: Bearer`. Os perfis vêm da claim `roles` e as filiais',
  '  da claim `branch_ids`. Fora das filiais do token, tudo responde `404`, como se não existisse.',
  '- **Versão**: toda escrita versionada exige `If-Match: "<versão>"`; sem ele, `428`; versão velha, `409',
  '  version_conflict`. A versão vem no `ETag` e no campo `version` do corpo.',
  '- **Erros**: `{ "error": "<código>", "message"?: "..." }`, com mensagem fixa e sem eco do valor enviado.',
  '- **Paginação**: por cursor (`cursor`, `limit`, `nextCursor`).',
  '- **LGPD**: só dado de empresa do cliente; nenhum CPF nem dado de paciente.',
].join('\n');

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
        description: DESCRIPTION,
      },
      tags: TAGS.map(({ name, description }) => ({ name, description })),
      components: {
        securitySchemes: {
          [BEARER_AUTH]: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  app.addHook('onRoute', (route) => {
    const tag = TAGS.find((t) => t.match.test(route.url));
    // O grupo daqui vence a tag local da rota: a referência fica organizada por assunto, em pt-BR.
    if (tag) route.schema = { ...route.schema, tags: [tag.name] };
    if (!usesAuthenticate(app, route)) return;
    route.schema = { ...route.schema, security: [{ [BEARER_AUTH]: [] }] };
  });

  app.get('/v1/openapi.json', { schema: { hide: true } }, async () => app.swagger());
});
