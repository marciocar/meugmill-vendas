import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiContext, createApi } from './api/client';
import { Dropdown } from './Dropdown';
import { useHost } from './host-context';
import { Shell } from './Shell';
import { useMe, type Me } from './use-me';

interface AppProps {
  apiBase: string | null;
  token: string | null;
  /** Mostra ferramentas de depuração (item "Simular token expirado"). */
  debug?: boolean;
}

/** Lista legível; "nenhum" quando vazia. O token nunca é exibido. */
function list(items: string[]): string {
  return items.length > 0 ? items.join(', ') : 'nenhum';
}

export function App({ apiBase, token, debug = false }: AppProps) {
  const { emitTokenExpired } = useHost();
  // Um evento `token-expired` por token, venha o 401 do /v1/me ou de qualquer tela.
  const firedFor = useRef<string | null>(null);
  const [expiredToken, setExpiredToken] = useState<string | null>(null);
  const notifyExpired = useCallback(() => {
    setExpiredToken(token);
    if (firedFor.current !== token) {
      firedFor.current = token;
      emitTokenExpired();
    }
  }, [token, emitTokenExpired]);

  const { state, retry } = useMe(apiBase, token, notifyExpired);

  // Último usuário autenticado: renovar o token (mesmo `sub`) não desmonta as telas nem perde o wizard.
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    if (state.status === 'authenticated') setMe(state.me);
    if (state.status === 'unconfigured') setMe(null);
  }, [state]);

  const api = useMemo(
    () => (apiBase && token ? createApi(apiBase, token, notifyExpired) : null),
    [apiBase, token, notifyExpired],
  );
  const expired = state.status === 'expired' || (token !== null && expiredToken === token);

  return (
    <section className="gc-root">
      <header className="gc-header">
        <h1>Carteira de Clientes</h1>
        <Dropdown label="Ações">
          {debug && (
            <li role="none">
              <button type="button" role="menuitem" className="gc-menu-item" onClick={emitTokenExpired}>
                Simular token expirado
              </button>
            </li>
          )}
        </Dropdown>
      </header>
      <div aria-live="polite" data-testid="status">
        {state.status === 'unconfigured' && <p>Configure a API e o token para carregar a carteira.</p>}
        {state.status === 'loading' && !me && <p>Carregando…</p>}
        {expired && (
          <p role="alert" className="gc-notice gc-notice-error">
            Sessão expirada
          </p>
        )}
        {state.status === 'unavailable' && !me && (
          <div role="alert">
            <p>Serviço indisponível no momento.</p>
            <button type="button" className="gc-button" onClick={retry}>
              Tentar de novo
            </button>
          </div>
        )}
        {me && state.status !== 'unconfigured' && (
          <dl className="gc-me">
            <dt>Usuário</dt>
            <dd data-testid="me-sub">{me.sub}</dd>
            <dt>Perfis</dt>
            <dd data-testid="me-roles">{list(me.roles)}</dd>
            <dt>Filiais</dt>
            <dd data-testid="me-branches">{list(me.branchIds)}</dd>
          </dl>
        )}
      </div>
      {me && api && state.status !== 'unconfigured' && (
        <ApiContext.Provider value={api}>
          <Shell key={me.sub} me={me} />
        </ApiContext.Provider>
      )}
    </section>
  );
}
