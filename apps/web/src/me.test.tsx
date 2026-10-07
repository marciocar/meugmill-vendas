import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { GmillCarteiraElement, TAG_NAME } from './element';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function mount(): Promise<GmillCarteiraElement> {
  const el = document.createElement(TAG_NAME) as GmillCarteiraElement;
  await act(async () => {
    document.body.appendChild(el);
  });
  return el;
}

async function configure(el: GmillCarteiraElement, apiBase: string | null, token: string | null) {
  await act(async () => {
    el.apiBase = apiBase;
    el.token = token;
  });
}

const text = (el: GmillCarteiraElement) => el.shadowRoot?.textContent ?? '';

describe('<gmill-carteira> /v1/me', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => {
      document.body.replaceChildren();
    });
  });

  it('200 renderiza sub, perfis e filiais, sem o token, e envia Bearer', async () => {
    const fetchMock = vi.fn(async () =>
      json(200, { sub: 'user-1', roles: ['vendedor', 'gestor'], branchIds: ['ES01', 'ES02'] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const el = await mount();
    await configure(el, 'http://api/', 'tok-secreto');

    expect(text(el)).toContain('user-1');
    expect(text(el)).toContain('vendedor, gestor');
    expect(text(el)).toContain('ES01, ES02');
    expect(el.shadowRoot?.innerHTML).not.toContain('tok-secreto');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/v1/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-secreto');
  });

  it('sem apiBase não chama fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const el = await mount();
    await configure(el, null, 'tok');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text(el)).toContain('Configure a API');
  });

  it('401 dispara token-expired uma vez e não refaz a chamada sozinho', async () => {
    const fetchMock = vi.fn(async () => json(401, { error: 'unauthorized' }));
    vi.stubGlobal('fetch', fetchMock);
    const received: Event[] = [];
    const listener = (e: Event) => received.push(e);
    document.addEventListener('token-expired', listener);
    try {
      const el = await mount();
      await configure(el, 'http://api', 'tok-velho');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(text(el)).toContain('Sessão expirada');
      expect(received).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('token-expired', listener);
    }
  });

  it('trocar o token refaz a busca', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(json(200, { sub: 'user-2', roles: [], branchIds: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const el = await mount();
    await configure(el, 'http://api', 'tok-1');
    expect(text(el)).toContain('Sessão expirada');
    await act(async () => {
      el.token = 'tok-2';
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-2');
    expect(text(el)).toContain('user-2');
  });

  it('503 mostra indisponível e "Tentar de novo" refaz a busca', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(503, { error: 'auth_unavailable' }))
      .mockResolvedValueOnce(json(200, { sub: 'user-3', roles: ['x'], branchIds: ['y'] }));
    vi.stubGlobal('fetch', fetchMock);
    const el = await mount();
    await configure(el, 'http://api', 'tok');
    expect(text(el)).toContain('Serviço indisponível');

    const retry = [...(el.shadowRoot?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Tentar de novo',
    );
    await act(async () => {
      retry?.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text(el)).toContain('user-3');
  });

  it('erro de rede mostra indisponível', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    const el = await mount();
    await configure(el, 'http://api', 'tok');
    expect(text(el)).toContain('Serviço indisponível');
  });

  it.each([
    ['json quebrado', () => new Response('{nao-json', { status: 200 })],
    ['sem sub', () => json(200, { roles: [], branchIds: [] })],
    ['sub vazio', () => json(200, { sub: '', roles: [], branchIds: [] })],
    ['roles não-array', () => json(200, { sub: 'u', roles: 'admin', branchIds: [] })],
  ])('200 com corpo inválido (%s) mostra indisponível, não autenticado', async (_name, make) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => make()),
    );
    const el = await mount();
    await configure(el, 'http://api', 'tok');
    expect(text(el)).toContain('Serviço indisponível');
    expect(el.shadowRoot?.querySelector('[data-testid="me-sub"]')).toBeNull();
  });

  it('ignora a resposta do token antigo quando o token troca com fetch em voo', async () => {
    let resolveOld!: (r: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((r) => (resolveOld = r)))
      .mockResolvedValueOnce(json(200, { sub: 'novo', roles: [], branchIds: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const el = await mount();
    await configure(el, 'http://api', 'tok-antigo');
    await act(async () => {
      el.token = 'tok-novo';
    });
    await act(async () => {
      resolveOld(json(200, { sub: 'antigo', roles: [], branchIds: [] }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(text(el)).toContain('novo');
    expect(text(el)).not.toContain('antigo');
  });

  it('token B que também dá 401 emite token-expired de novo (uma vez por token)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(401, {})),
    );
    const received: Event[] = [];
    const listener = (e: Event) => received.push(e);
    document.addEventListener('token-expired', listener);
    try {
      const el = await mount();
      await configure(el, 'http://api', 'tok-A');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(received).toHaveLength(1);
      await act(async () => {
        el.token = 'tok-B';
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(received).toHaveLength(2);
    } finally {
      document.removeEventListener('token-expired', listener);
    }
  });
});
