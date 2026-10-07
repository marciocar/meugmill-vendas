import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { UserClaims } from '@meugmill/shared';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/me',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: Type.Object({
            sub: Type.String(),
            roles: Type.Array(Type.String()),
            branchIds: Type.Array(Type.String()),
          }),
        },
      },
    },
    async (request): Promise<UserClaims> => {
      // authenticate já respondeu 401/503 quando não há usuário; guard de defesa em profundidade.
      if (!request.user) throw new Error('request.user ausente após authenticate');
      return request.user;
    },
  );
}
