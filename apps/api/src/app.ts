import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JWTVerifyGetKey } from 'jose';
import type { AppConfig } from './config.js';
import { authPlugin } from './plugins/auth.js';
import { dbPlugin } from './plugins/db.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';

export interface BuildAppOptions {
  /** Substitui a busca da JWKS remota (uso em testes). */
  keyGetter?: JWTVerifyGetKey;
}

export function buildApp(config: AppConfig, options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL },
  });

  // Lista vazia = nenhuma origem cruzada liberada. Sem credentials: o token vai no header.
  void app.register(cors, {
    origin: config.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
  });
  void app.register(dbPlugin, { config });
  void app.register(authPlugin, {
    config,
    ...(options.keyGetter ? { keyGetter: options.keyGetter } : {}),
  });
  void app.register(healthRoutes);
  void app.register(meRoutes, { prefix: '/v1' });

  return app;
}
