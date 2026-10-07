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
 * - Propriedade `token`: JWT do usuário. Este é o ÚNICO caminho suportado; ela
 *   NÃO é refletida como atributo e nunca é persistida em storage. O atributo
 *   `token` não é observado: se existir no HTML, é lido uma vez no
 *   connectedCallback, aplicado via propriedade e removido do DOM na hora.
 * - Atributo booleano `debug`: exibe o item "Simular token expirado" no menu
 *   (somente para demo/desenvolvimento; ausente em produção).
 * - Evento `token-expired` (CustomEvent, bubbles + composed): emitido quando a
 *   API recusar o token; o host deve renovar e setar `token` novamente.
 * - Todo CSS vive dentro do shadow root (open); nada vaza para o host.
 */
export class GmillCarteiraElement extends HTMLElement {
  static observedAttributes = ['api-base', 'debug'];

  #root: Root | null = null;
  #mountPoint: HTMLDivElement | null = null;
  #portalContainer: HTMLDivElement | null = null;
  // Último valor recebido, por atributo ou por propriedade.
  #apiBase: string | null = null;
  #token: string | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.#upgradeProperty('apiBase');
    this.#upgradeProperty('token');
  }

  /**
   * "Lazy property upgrade": se o host setou a propriedade antes de o elemento
   * ser definido, o valor virou propriedade própria da instância e esconde o
   * setter da classe. Lê, remove a própria e reatribui via setter.
   */
  #upgradeProperty(prop: 'apiBase' | 'token'): void {
    if (Object.prototype.hasOwnProperty.call(this, prop)) {
      const value = (this as unknown as Record<string, string | null>)[prop];
      delete (this as unknown as Record<string, unknown>)[prop];
      this[prop] = value ?? null;
    }
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
    this.#render();
  }

  connectedCallback(): void {
    this.#upgradeProperty('apiBase');
    this.#upgradeProperty('token');
    // Atributo `token` não é suportado: consome uma vez e tira o segredo do DOM.
    const attrToken = this.getAttribute('token');
    if (attrToken !== null) {
      this.removeAttribute('token');
      this.#token ??= attrToken;
    }
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
          <App apiBase={this.#apiBase} token={this.#token} debug={this.hasAttribute('debug')} />
        </HostContext.Provider>
      </StrictMode>,
    );
  }
}

if (!customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, GmillCarteiraElement);
}
