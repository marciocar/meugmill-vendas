import type { FastifyInstance } from 'fastify';
import {
  BranchResponseSchema,
  CreateBranchSchema,
  UpdateBranchSchema,
} from '../../domain/branches/schemas.js';
import { createBranchService, type BranchService } from '../../domain/branches/service.js';
import { registerCrudRoutes } from './crud.js';

export function registerBranchRoutes(
  app: FastifyInstance,
  opts: { prefix: string; service: BranchService },
): void {
  registerCrudRoutes(app, {
    prefix: opts.prefix,
    service: opts.service,
    responseSchema: BranchResponseSchema,
    createSchema: CreateBranchSchema,
    updateSchema: UpdateBranchSchema,
    tag: 'branches',
  });
}

/** Plugin: filiais. */
export async function branchRoutes(app: FastifyInstance): Promise<void> {
  registerBranchRoutes(app, { prefix: '/branches', service: createBranchService(app.db) });
}
