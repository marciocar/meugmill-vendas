import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { generateOpenApiJson } from '../../scripts/openapi-lib.js';
import { TAGS } from '../../src/plugins/openapi.js';

type Operation = {
  security?: unknown[];
  parameters?: { name: string; in: string }[];
  responses?: Record<string, { description?: string; headers?: Record<string, unknown> }>;
};
type Doc = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, unknown> };
};

const PATHS = [
  '/v1/customers',
  '/v1/customers/{id}',
  '/v1/customers/by-cnpj/{cnpj}/branches',
  '/v1/sellers',
  '/v1/sellers/by-code/{code}/branches',
  '/v1/branches',
  '/v1/product-subgroups',
  '/v1/retail-networks',
  '/v1/economic-groups',
  '/v1/geo/states',
  '/v1/geo/municipalities',
  '/v1/me',
];

const here = dirname(fileURLToPath(import.meta.url));

describe('OpenAPI v1', () => {
  let app: FastifyInstance;
  let doc: Doc;

  beforeAll(async () => {
    app = buildApp(
      loadConfig({
        LOG_LEVEL: 'silent',
        NODE_ENV: 'test',
        DATABASE_PATH: ':memory:',
        OIDC_ISSUER: 'https://idp.test',
        OIDC_AUDIENCE: 'meugmill',
      }),
    );
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    doc = res.json<Doc>();
  });
  afterAll(() => app.close());

  it('é OpenAPI 3.x com título e versão do package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8')) as {
      version: string;
    };
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBe('MeuGmill Vendas — Carteira de Clientes API');
    expect(doc.info.version).toBe(pkg.version);
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it.each(PATHS)('contém o path %s', (path) => {
    expect(Object.keys(doc.paths)).toContain(path);
  });

  it('PATCH/deactivate/reactivate documentam If-Match, 409 e 428', () => {
    for (const [path, method] of [
      ['/v1/customers/{id}', 'patch'],
      ['/v1/product-subgroups/{id}', 'patch'],
      ['/v1/product-subgroups/{id}/deactivate', 'post'],
      ['/v1/product-subgroups/{id}/reactivate', 'post'],
    ] as const) {
      const op = doc.paths[path]?.[method];
      expect(op, `${method} ${path}`).toBeDefined();
      expect(op?.parameters).toContainEqual(expect.objectContaining({ name: 'if-match', in: 'header' }));
      expect(Object.keys(op?.responses ?? {})).toEqual(expect.arrayContaining(['409', '428']));
    }
  });

  it('declara o header ETag nas respostas de GET por id, POST, PATCH, deactivate, reactivate e links', () => {
    const ops: [string, string, string][] = [
      ['/v1/customers/{id}', 'get', '200'],
      ['/v1/customers', 'post', '201'],
      ['/v1/customers/{id}', 'patch', '200'],
      ['/v1/customers/{id}/deactivate', 'post', '200'],
      ['/v1/customers/{id}/reactivate', 'post', '200'],
      ['/v1/customers/by-cnpj/{cnpj}/branches', 'post', '200'],
      ['/v1/sellers/{id}', 'get', '200'],
      ['/v1/sellers', 'post', '201'],
      ['/v1/sellers/{id}', 'patch', '200'],
      ['/v1/sellers/{id}/deactivate', 'post', '200'],
      ['/v1/sellers/{id}/reactivate', 'post', '200'],
      ['/v1/sellers/by-code/{code}/branches', 'post', '200'],
      ['/v1/branches/{id}', 'get', '200'],
      ['/v1/retail-networks', 'post', '201'],
    ];
    for (const [path, method, status] of ops) {
      const response = doc.paths[path]?.[method]?.responses?.[status];
      expect(response?.headers, `${method} ${path} ${status}`).toHaveProperty('ETag');
    }
    // listas não têm ETag
    expect(doc.paths['/v1/customers']?.get?.responses?.['200']?.headers).toBeUndefined();
  });

  it('documenta os códigos de conflito 409, incluindo seller_exists', () => {
    const description = doc.paths['/v1/sellers']?.post?.responses?.['409']?.description ?? '';
    for (const code of ['conflict', 'customer_exists', 'seller_exists', 'version_conflict']) {
      expect(description).toContain(code);
    }
    const portfolio = doc.paths['/v1/portfolios/{id}']?.patch?.responses?.['409']?.description ?? '';
    expect(portfolio).toContain('portfolio_inactive');
  });

  it('rotas autenticadas têm bearerAuth; health, ready e openapi não têm', () => {
    expect(doc.paths['/v1/customers']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/v1/geo/states']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/v1/me']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/health']?.get?.security).toBeUndefined();
    expect(doc.paths['/ready']?.get?.security).toBeUndefined();
    expect(doc.paths['/v1/openapi.json']).toBeUndefined();
  });

  it('toda operação cai num grupo da documentação, e só nos grupos declarados', () => {
    const names = TAGS.map((t) => t.name);
    const raw = doc as unknown as {
      tags?: { name: string }[];
      paths: Record<string, Record<string, { tags?: string[] }>>;
    };
    expect(raw.tags?.map((t) => t.name)).toEqual(names);
    const untagged: string[] = [];
    for (const [path, ops] of Object.entries(raw.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (op.tags?.length !== 1 || !names.includes(op.tags[0]!)) untagged.push(`${method} ${path}`);
      }
    }
    expect(untagged).toEqual([]);
    expect(raw.paths['/v1/portfolios/{id}/preview']?.get?.tags).toEqual(['Elegibilidade e ajustes']);
    expect(raw.paths['/v1/link-events']?.get?.tags).toEqual(['Vínculos']);
  });

  it('não expõe interface visual', async () => {
    const res = await app.inject({ method: 'GET', url: '/documentation' });
    expect(res.statusCode).toBe(404);
  });

  it('openapi-v1.json versionado está em dia (rode `pnpm --filter @meugmill/api openapi:export`)', async () => {
    const file = resolve(here, '../../../../docs/technical-context/openapi-v1.json');
    expect(readFileSync(file, 'utf8')).toBe(await generateOpenApiJson());
  });
});
