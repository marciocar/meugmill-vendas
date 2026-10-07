import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { dbPlugin } from './plugins/db.js';
import { healthRoutes } from './routes/health.js';

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL },
  });

  // Plugins (auth, observability) entram aqui nas próximas fases (src/plugins/).
  void app.register(dbPlugin, { config });
  void app.register(healthRoutes);

  return app;
}
