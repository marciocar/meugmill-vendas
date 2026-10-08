import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, listAll } from './client';
import { describeError } from './errors';
import { competitorsText } from '../portfolios/StepCustomers';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('createApi', () => {
  it('escrita manda Bearer, JSON e If-Match com a versão; query ignora vazios', async () => {
    const fetchMock = vi.fn(async () => json(200, { id: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApi('http://api/', 'tok', () => {});
    await api.send('PUT', '/v1/portfolios/1/filters', {
      body: { regions: [] },
      version: 7,
      query: { a: '', b: 2 },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/v1/portfolios/1/filters?b=2');
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
      'If-Match': '"7"',
    });
    expect(JSON.parse(init.body as string)).toEqual({ regions: [] });
  });

  it('401 chama onExpired e vira ApiError unauthorized', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(401, { error: 'unauthorized' })),
    );
    const onExpired = vi.fn();
    const api = createApi('http://api', 'tok', onExpired);
    await expect(api.get('/v1/portfolios')).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('erro da API carrega código, mensagem fixa e detail; falha de rede vira network_error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(409, {
          error: 'portfolio_incomplete',
          message: 'Incompleta',
          detail: { unassigned: 3, stale: 1 },
        }),
      ),
    );
    const api = createApi('http://api', 'tok', () => {});
    const err = (await api.send('POST', '/v1/portfolios/1/finalize').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.detail).toEqual({ unassigned: 3, stale: 1 });
    expect(describeError(err)).toBe(
      'Não dá para finalizar: 3 célula(s) sem vendedor e 1 com vendedor inválido.',
    );

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(api.get('/v1/me')).rejects.toMatchObject({ code: 'network_error' });
  });

  it('upload manda o arquivo cru como text/csv', async () => {
    const fetchMock = vi.fn(async () => json(202, { id: 9 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new Blob(['codigo;nome\n'], { type: 'text/csv' });
    await createApi('http://api', 'tok', () => {}).upload('/v1/imports', { layout: 'branches' }, file);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/v1/imports?layout=branches');
    expect(init.body).toBe(file);
    expect(init.headers).toMatchObject({ 'Content-Type': 'text/csv' });
  });

  it('download devolve o blob e o nome do Content-Disposition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('a;b', { headers: { 'Content-Disposition': 'attachment; filename="branches.csv"' } }),
      ),
    );
    const out = await createApi('http://api', 'tok', () => {}).download('/v1/exports/branches');
    expect(out.filename).toBe('branches.csv');
    expect(await out.blob.text()).toBe('a;b');
  });

  it('listAll segue o cursor até o fim', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { items: [1, 2], nextCursor: 'c1' }))
      .mockResolvedValueOnce(json(200, { items: [3], nextCursor: null }));
    vi.stubGlobal('fetch', fetchMock);
    const all = await listAll<number>(
      createApi('http://api', 'tok', () => {}),
      '/v1/branches',
      { active: true },
    );
    expect(all).toEqual([1, 2, 3]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('cursor=c1');
  });
});

describe('describeError', () => {
  it('prefere o texto da tela para version_conflict e mostra a mensagem fixa do domínio nos demais 4xx', () => {
    expect(describeError(new ApiError(409, 'version_conflict', 'Versão desatualizada', null))).toMatch(
      /Outra pessoa/,
    );
    expect(describeError(new ApiError(400, 'validation_error', 'Bairro inválido', null))).toBe(
      'Bairro inválido',
    );
    expect(describeError(new ApiError(413, 'bad_request', null, null))).toMatch(/16 MB/);
    expect(describeError(new ApiError(500, 'internal_error', 'stack', null))).toBe(
      'Erro inesperado no serviço.',
    );
  });
});

describe('competitorsText', () => {
  it('mostra até 2 nomes e resume o resto', () => {
    expect(competitorsText(['A'])).toBe('A');
    expect(competitorsText(['A', 'B'])).toBe('A e B');
    expect(competitorsText(['A', 'B', 'C', 'D'])).toBe('A, B e mais 2');
  });
});
