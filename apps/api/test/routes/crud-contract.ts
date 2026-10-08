import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v1Routes } from '../../src/routes/v1/index.js';
import { makeRoutesFixture, ADMIN, READER, type RoutesFixture, type TokenOptions } from '../helpers/jwt.js';

export interface CrudContract {
  name: string;
  path: string;
  /** Corpo válido de criação com o código dado. */
  body(code: string): Record<string, unknown>;
  /** Corpo de PATCH válido. */
  patch: Record<string, unknown>;
  /** Roda depois de montar o app (ex.: inserir fixtures). */
  setup?(fx: RoutesFixture): void;
  admin?: TokenOptions;
  reader?: TokenOptions;
}

/** Suíte de contrato HTTP comum aos cadastros CRUD. */
export function crudContract(c: CrudContract): void {
  describe(`contrato HTTP ${c.name}`, () => {
    let fx: RoutesFixture;
    const admin = c.admin ?? ADMIN;
    const reader = c.reader ?? READER;
    beforeAll(async () => {
      fx = await makeRoutesFixture(v1Routes);
      c.setup?.(fx);
    });
    afterAll(() => fx.close());

    const call = async (
      method: 'GET' | 'POST' | 'PATCH',
      url: string,
      who: TokenOptions | null,
      extra: { body?: unknown; ifMatch?: string } = {},
    ) =>
      fx.app.inject({
        method,
        url: `/v1/${c.path}${url}`,
        headers: who
          ? await fx.headers({ ...who, ...(extra.ifMatch !== undefined ? { ifMatch: extra.ifMatch } : {}) })
          : {},
        ...(extra.body !== undefined ? { payload: extra.body as object } : {}),
      });

    it('401 sem token', async () => {
      expect((await call('GET', '', null)).statusCode).toBe(401);
      expect((await call('POST', '', null, { body: c.body('X') })).statusCode).toBe(401);
    });

    it('anônimo recebe 401 mesmo com corpo ou id inválidos (auth antes da validação)', async () => {
      expect((await call('POST', '', null, { body: { lixo: true } })).statusCode).toBe(401);
      expect((await call('PATCH', '/abc', null, { body: { lixo: true } })).statusCode).toBe(401);
      expect((await call('GET', '/abc', null)).statusCode).toBe(401);
    });

    it('If-Match malformado -> 400 validation_error, sem eco', async () => {
      const created = (await call('POST', '', admin, { body: c.body('M1') })).json<{ id: number }>();
      for (const bad of ['*', 'abc-secreto', '"0"']) {
        const res = await call('PATCH', `/${created.id}`, admin, { body: c.patch, ifMatch: bad });
        expect(res.statusCode, bad).toBe(400);
        expect(res.json<{ error: string }>().error).toBe('validation_error');
        expect(res.body).not.toContain('secreto');
      }
    });

    it('não-admin recebe 403 em POST e PATCH, sem eco', async () => {
      const res = await call('POST', '', reader, { body: c.body('SECRETO-1') });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
      expect(res.body).not.toContain('SECRETO-1');
    });

    it('admin cria (201 + ETag "1"), leitor consulta e lista', async () => {
      const res = await call('POST', '', admin, { body: c.body('A1') });
      expect(res.statusCode).toBe(201);
      expect(res.headers.etag).toBe('"1"');
      const created = res.json<{ id: number; code: string }>();
      expect(created.code).toBe('A1');

      const got = await call('GET', `/${created.id}`, reader);
      expect(got.statusCode).toBe(200);
      expect(got.headers.etag).toBe('"1"');
      const list = await call('GET', '', reader);
      expect(list.statusCode).toBe(200);
      expect(list.json<{ items: unknown[] }>().items.length).toBeGreaterThan(0);
    });

    it('código duplicado -> 409 conflict', async () => {
      const res = await call('POST', '', admin, { body: c.body('A1') });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'conflict' });
    });

    it('PATCH: sem If-Match 428, velho 409, ok devolve ETag "2"', async () => {
      const created = (await call('POST', '', admin, { body: c.body('P1') })).json<{ id: number }>();
      const url = `/${created.id}`;
      const none = await call('PATCH', url, admin, { body: c.patch });
      expect(none.statusCode).toBe(428);
      expect(none.json()).toEqual({ error: 'precondition_required' });

      const ok = await call('PATCH', url, admin, { body: c.patch, ifMatch: '"1"' });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers.etag).toBe('"2"');

      const stale = await call('PATCH', url, admin, { body: c.patch, ifMatch: '"1"' });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toEqual({ error: 'version_conflict' });

      const denied = await call('PATCH', url, reader, { body: c.patch, ifMatch: '"2"' });
      expect(denied.statusCode).toBe(403);
    });

    it('deactivate e reactivate são idempotentes', async () => {
      const created = (await call('POST', '', admin, { body: c.body('D1') })).json<{ id: number }>();
      const send = async (action: string, ifMatch?: string) =>
        fx.app.inject({
          method: 'POST',
          url: `/v1/${c.path}/${created.id}/${action}`,
          headers: await fx.headers({ ...admin, ...(ifMatch ? { ifMatch } : {}) }),
        });
      expect((await send('deactivate')).statusCode).toBe(428);
      const off = await send('deactivate', '1');
      expect(off.statusCode).toBe(200);
      expect(off.json<{ active: boolean }>().active).toBe(false);
      expect(off.headers.etag).toBe('"2"');
      const again = await send('deactivate', '2');
      expect(again.statusCode).toBe(200);
      expect(again.json<{ active: boolean }>().active).toBe(false);
      const on = await send('reactivate', again.headers.etag as string);
      expect(on.json<{ active: boolean }>().active).toBe(true);
      const onAgain = await send('reactivate', on.headers.etag as string);
      expect(onAgain.statusCode).toBe(200);
      expect(onAgain.json<{ active: boolean }>().active).toBe(true);
    });

    it('id inválido -> 400 sem eco; inexistente -> 404', async () => {
      const bad = await call('GET', '/abcxyz', reader);
      expect(bad.statusCode).toBe(400);
      expect(bad.json<{ error: string }>().error).toBe('validation_error');
      expect(bad.body).not.toContain('abcxyz');
      expect((await call('GET', '/0', reader)).statusCode).toBe(400);
      const missing = await call('GET', '/999999', reader);
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ error: 'not_found' });
    });

    it('paginação com cursor', async () => {
      for (const code of ['G1', 'G2', 'G3']) await call('POST', '', admin, { body: c.body(code) });
      const seen = new Set<number>();
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await call('GET', `?limit=2${cursor ? `&cursor=${cursor}` : ''}`, reader);
        const page = res.json<{ items: { id: number }[]; nextCursor: string | null }>();
        expect(page.items.length).toBeLessThanOrEqual(2);
        for (const i of page.items) seen.add(i.id);
        cursor = page.nextCursor;
        pages++;
      } while (cursor && pages < 20);
      expect(pages).toBeGreaterThan(1);
      expect(seen.size).toBeGreaterThanOrEqual(5);
      expect((await call('GET', '?limit=0', reader)).statusCode).toBe(400);
      expect((await call('GET', '?cursor=@@@', reader)).statusCode).toBe(400);
    });
  });
}
