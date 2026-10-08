import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  MunicipalityQuerySchema,
  MunicipalityResponseSchema,
  StateResponseSchema,
  type MunicipalityQuery,
} from '../../domain/geo/schemas.js';
import { createGeoService } from '../../domain/geo/service.js';
import { toActor } from '../../domain/shared/authz.js';
import { PageSchema } from '../../domain/shared/pagination.js';
import { ERROR_RESPONSES, sendDomainError } from './http.js';

/** Plugin: localidades IBGE (leitura). */
export async function geoRoutes(app: FastifyInstance): Promise<void> {
  const service = createGeoService(app.db);
  // onRequest: a autenticação roda antes da validação da query (anônimo é sempre 401).
  const onRequest = app.authenticate;
  const tags = ['geo'];

  app.get(
    '/geo/states',
    {
      onRequest,
      schema: { tags, response: { 200: Type.Array(StateResponseSchema), ...ERROR_RESPONSES } },
    },
    async (request, reply) => {
      try {
        if (!request.user) throw new Error('request.user ausente após authenticate');
        return service.listStates(toActor(request.user));
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get(
    '/geo/municipalities',
    {
      onRequest,
      schema: {
        tags,
        querystring: MunicipalityQuerySchema,
        response: { 200: PageSchema(MunicipalityResponseSchema), ...ERROR_RESPONSES },
      },
    },
    async (request, reply) => {
      try {
        if (!request.user) throw new Error('request.user ausente após authenticate');
        return service.listMunicipalities(toActor(request.user), request.query as MunicipalityQuery);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );
}
