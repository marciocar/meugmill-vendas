import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        response: { 200: Type.Object({ status: Type.Literal('ok') }) },
      },
    },
    async () => ({ status: 'ok' as const }),
  );

  app.get(
    '/ready',
    {
      schema: {
        response: {
          200: Type.Object({ status: Type.Literal('ready') }),
          503: Type.Object({ status: Type.Literal('unavailable') }),
        },
      },
    },
    async (_req, reply) => {
      try {
        app.sqlite.prepare('select 1').get();
        return { status: 'ready' as const };
      } catch (err) {
        app.log.error({ err }, 'Banco indisponível no /ready');
        return reply.code(503).send({ status: 'unavailable' as const });
      }
    },
  );
}
