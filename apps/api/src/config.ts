import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

// Para acrescentar variáveis (DATABASE_PATH, OIDC_*, CORS_ORIGINS), adicione campos aqui.
const ConfigSchema = Type.Object({
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  HOST: Type.String({ minLength: 1, default: '0.0.0.0' }),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal('fatal'),
      Type.Literal('error'),
      Type.Literal('warn'),
      Type.Literal('info'),
      Type.Literal('debug'),
      Type.Literal('trace'),
      Type.Literal('silent'),
    ],
    { default: 'info' },
  ),
  NODE_ENV: Type.Union([Type.Literal('development'), Type.Literal('test'), Type.Literal('production')], {
    default: 'development',
  }),
});

export type AppConfig = Static<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuração inválida:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(ConfigSchema.properties)) {
    const value = source[key];
    if (value !== undefined && value !== '') raw[key] = value;
  }

  // Aplica defaults e converte strings para o tipo do schema; valores inconvertíveis
  // permanecem como estão e falham na validação, citando a variável.
  const candidate = Value.Convert(ConfigSchema, Value.Default(ConfigSchema, raw));

  if (!Value.Check(ConfigSchema, candidate)) {
    const issues = [...Value.Errors(ConfigSchema, candidate)].map(
      (e) => `${e.path.replace(/^\//, '') || '(raiz)'}: ${e.message}`,
    );
    throw new ConfigError(issues);
  }
  return candidate;
}
