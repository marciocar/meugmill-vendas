import type { Actor } from './authz.js';
import type { ListParams, Page } from './pagination.js';

/**
 * Contrato comum dos cadastros. Os services são SÍNCRONOS (better-sqlite3): as rotas chamam direto.
 * `expectedVersion` vem do `If-Match`; `undefined` vira `precondition_required`.
 */
export interface CrudService<Response, Create, Update> {
  list(actor: Actor, params?: ListParams): Page<Response>;
  get(actor: Actor, id: number): Response;
  create(actor: Actor, input: Create): Response;
  update(actor: Actor, id: number, expectedVersion: number | undefined, patch: Update): Response;
  deactivate(actor: Actor, id: number, expectedVersion: number | undefined): Response;
  reactivate(actor: Actor, id: number, expectedVersion: number | undefined): Response;
}
