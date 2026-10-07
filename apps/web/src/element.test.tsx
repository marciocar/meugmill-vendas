import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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
    expect(el.shadowRoot?.textContent).toContain('http://localhost:3000');
  });

  it('token por propriedade atualiza o render sem refletir atributo nem expor valor', async () => {
    const el = await mount();
    expect(el.shadowRoot?.textContent).toContain('Token: ausente');
    await act(async () => {
      el.token = 'segredo-abc';
    });
    expect(el.shadowRoot?.textContent).toContain('Token: presente');
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
});
