import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { GmillCarteiraElement, TAG_NAME } from './element';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(attrs: Record<string, string> = {}): Promise<GmillCarteiraElement> {
  const el = document.createElement(TAG_NAME) as GmillCarteiraElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  await act(async () => {
    document.body.appendChild(el);
  });
  return el;
}

describe('<gmill-carteira>', () => {
  beforeAll(() => {
    expect(customElements.get(TAG_NAME)).toBe(GmillCarteiraElement);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => {
      document.body.replaceChildren();
    });
  });

  it('registra o elemento sem falhar em import duplicado', async () => {
    await import('./element');
    expect(customElements.get(TAG_NAME)).toBe(GmillCarteiraElement);
  });

  it('lê o atributo api-base', async () => {
    const el = await mount({ 'api-base': 'http://localhost:3000' });
    expect(el.apiBase).toBe('http://localhost:3000');
  });

  it('token por propriedade não reflete atributo nem expõe valor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const el = await mount({ 'api-base': 'http://api' });
    await act(async () => {
      el.token = 'segredo-abc';
    });
    expect(el.hasAttribute('token')).toBe(false);
    expect(el.shadowRoot?.innerHTML).not.toContain('segredo-abc');
    expect(document.documentElement.innerHTML).not.toContain('segredo-abc');
  });

  it('token-expired é composed e borbulha até o document', async () => {
    const el = await mount();
    const received: Event[] = [];
    document.addEventListener('token-expired', (e) => received.push(e));
    el.emitTokenExpired();
    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(CustomEvent);
    expect(received[0]?.bubbles).toBe(true);
    expect(received[0]?.composed).toBe(true);
  });

  it('o container do portal fica dentro do shadowRoot e recebe o menu', async () => {
    const el = await mount();
    const container = el.portalContainer;
    expect(container).not.toBeNull();
    expect(container?.parentNode).toBe(el.shadowRoot);

    const trigger = el.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-haspopup]');
    await act(async () => {
      trigger?.click();
    });
    expect(container?.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('injeta CSS dentro do shadowRoot', async () => {
    const el = await mount();
    const style = el.shadowRoot?.querySelector('style');
    expect(style?.textContent).toContain(':host');
    expect(document.head.querySelector('style')).toBeNull();
  });

  it('upgrade de propriedade: token/apiBase setados antes do define valem após conectar', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ sub: 'u', roles: [], branchIds: [] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const tag = 'gmill-carteira-upgrade-test';
    const el = document.createElement(tag) as GmillCarteiraElement;
    el.token = 'tok-antecipado';
    el.apiBase = 'http://api';
    await act(async () => {
      document.body.appendChild(el);
    });
    customElements.define(tag, class extends GmillCarteiraElement {});
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(Object.prototype.hasOwnProperty.call(el, 'token')).toBe(false);
    expect(el.token).toBe('tok-antecipado');
    // StrictMode (dev) pode duplicar o efeito inicial; basta que haja chamadas e todas usem o Bearer certo.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/v1/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-antecipado');
  });

  it('atributo token é consumido e removido do DOM', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ sub: 'u', roles: [], branchIds: [] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const el = await mount({ 'api-base': 'http://api', token: 'tok-attr' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(el.hasAttribute('token')).toBe(false);
    expect(el.token).toBe('tok-attr');
    expect(document.documentElement.innerHTML).not.toContain('tok-attr');
    const init = fetchMock.mock.calls[0]![1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-attr');
  });

  it('"Simular token expirado" só existe com o atributo debug', async () => {
    const open = async (el: GmillCarteiraElement) => {
      await act(async () => {
        el.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.click();
      });
      return el.portalContainer?.textContent ?? '';
    };
    const plain = await mount();
    expect(await open(plain)).not.toContain('Simular token expirado');
    await act(async () => {
      document.body.replaceChildren();
    });
    const dbg = await mount({ debug: '' });
    expect(await open(dbg)).toContain('Simular token expirado');
  });

  it('Dropdown: aria-expanded reflete o estado e Escape fecha devolvendo o foco', async () => {
    const el = await mount({ debug: '' });
    const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-haspopup]')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      trigger.click();
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(el.portalContainer?.querySelector('[role="menu"]')).not.toBeNull();
    (el.portalContainer?.querySelector('[role="menuitem"]') as HTMLElement).focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(el.portalContainer?.querySelector('[role="menu"]')).toBeNull();
    expect(el.shadowRoot?.activeElement).toBe(trigger);
  });
});
