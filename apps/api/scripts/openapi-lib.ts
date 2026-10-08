import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/** Sobe o app em memória (config mínima, sem rede) e devolve o OpenAPI com chaves ordenadas. */
export async function generateOpenApiJson(): Promise<string> {
  const config = loadConfig({
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    OIDC_ISSUER: 'https://idp.example',
    OIDC_AUDIENCE: 'meugmill',
  });
  const app = buildApp(config);
  try {
    await app.ready();
    return `${JSON.stringify(sortKeys(app.swagger()), null, 2)}\n`;
  } finally {
    await app.close();
  }
}
