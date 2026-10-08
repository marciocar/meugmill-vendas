// Grava o contrato OpenAPI estático em docs/technical-context/openapi-v1.json:
//
//   pnpm --filter @meugmill/api openapi:export
//
// Um teste falha se o arquivo versionado divergir do gerado.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateOpenApiJson } from './openapi-lib.js';

const target = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/technical-context/openapi-v1.json',
);

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, await generateOpenApiJson());
console.log(`OpenAPI gravado em ${target}`);
