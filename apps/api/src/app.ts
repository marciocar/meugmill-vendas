import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JWTVerifyGetKey } from 'jose';
import type { AppConfig } from './config.js';
import { authPlugin } from './plugins/auth.js';
import {
  buildLoggerOptions,
  genReqId,
  observabilityPlugin,
  REQUEST_ID_HEADER,
  type LogStream,
} from './plugins/observability.js';
import { dbPlugin } from './plugins/db.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';

export interface BuildAppOptions {
  /** Substitui a busca da JWKS remota (uso em testes). */
  keyGetter?: JWTVerifyGetKey;
  /** Destino do log (uso em testes, para capturar as linhas). */
  logStream?: LogStream;
  /** Cooldown do discovery OIDC após falha, em ms (uso em testes; default 10s). */
  discoveryCooldownMs?: number;
}

export function buildApp(config: AppConfig, options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: buildLoggerOptions(config, options.logStream),
    // O id do cliente só é aceito se seguro; a validação fica no genReqId.
    requestIdHeader: false,
    genReqId,
  });
  void app.register(observabilityPlugin);

  // Lista vazia = nenhuma origem cruzada liberada. Sem credentials: o token vai no header.
  void app.register(cors, {
    origin: config.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: [REQUEST_ID_HEADER],
    credentials: false,
  });
  void app.register(dbPlugin, { config });
  void app.register(authPlugin, {
    config,
    ...(options.keyGetter ? { keyGetter: options.keyGetter } : {}),
    ...(options.discoveryCooldownMs !== undefined
      ? { discoveryCooldownMs: options.discoveryCooldownMs }
      : {}),
  });
  void app.register(healthRoutes);
  void app.register(meRoutes, { prefix: '/v1' });

  return app;
}
