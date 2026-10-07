import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import { HostContext } from './host-context';
import styles from './styles.css?inline';

export const TAG_NAME = 'gmill-carteira';
export const TOKEN_EXPIRED_EVENT = 'token-expired';

/**
 * Custom element `<gmill-carteira>`.
 *
 * Contrato com o host:
 * - Atributo `api-base` (ou propriedade `apiBase`): URL base da API.
 * - Atributo `token` (ou propriedade `token`): JWT do usuário. Preferir a
 *   propriedade, pois o atributo expõe o token no DOM. Quando setado por
 *   propriedade, NÃO é refletido como atributo e nunca é persistido em storage.
 * - Evento `token-expired` (CustomEvent, bubbles + composed): emitido quando a
 *   API recusar o token; o host deve renovar e setar `token` novamente.
 * - Todo CSS vive dentro do shadow root (open); nada vaza para o host.
 */
export class GmillCarteiraElement extends HTMLElement {
  static observedAttributes = ['api-base', 'token'];

  #root: Root | null = null;
  #mountPoint: HTMLDivElement | null = null;
  #portalContainer: HTMLDivElement | null = null;
  // Último valor recebido, por atributo ou por propriedade.
  #apiBase: string | null = null;
  #token: string | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get apiBase(): string | null {
    return this.#apiBase;
  }
  set apiBase(value: string | null) {
    this.#apiBase = value;
    this.#render();
  }

  get token(): string | null {
    return this.#token;
  }
  set token(value: string | null) {
    this.#token = value;
    this.#render();
  }

  /** Nó dentro do shadow root para portais (null antes de conectar). */
  get portalContainer(): HTMLElement | null {
    return this.#portalContainer;
  }

  /** Avisa o host que o token expirou. */
  emitTokenExpired = (): void => {
    this.dispatchEvent(new CustomEvent(TOKEN_EXPIRED_EVENT, { bubbles: true, composed: true }));
  };

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    // Atributo -> estado interno (sem refletir de volta).
    if (name === 'api-base') this.#apiBase = value;
    else if (name === 'token') this.#token = value;
    this.#render();
  }

  connectedCallback(): void {
    if (this.#root) return;
    const shadow = this.shadowRoot!;
    const style = document.createElement('style');
    style.textContent = styles;
    this.#mountPoint = document.createElement('div');
    this.#portalContainer = document.createElement('div');
    this.#portalContainer.setAttribute('data-gmill-portal', '');
    shadow.append(style, this.#mountPoint, this.#portalContainer);
    this.#root = createRoot(this.#mountPoint);
    this.#render();
  }

  disconnectedCallback(): void {
    this.#root?.unmount();
    this.#root = null;
    this.shadowRoot?.replaceChildren();
    this.#mountPoint = null;
    this.#portalContainer = null;
  }

  #render(): void {
    if (!this.#root) return;
    this.#root.render(
      <StrictMode>
        <HostContext.Provider
          value={{
            portalContainer: this.#portalContainer,
            emitTokenExpired: this.emitTokenExpired,
          }}
        >
          <App apiBase={this.#apiBase} token={this.#token} />
        </HostContext.Provider>
      </StrictMode>,
    );
  }
}

if (!customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, GmillCarteiraElement);
}
