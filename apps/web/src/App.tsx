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
  const tokenRef = useRef(token);
  tokenRef.current = token;
  // Um evento `token-expired` por token, venha o 401 do /v1/me ou de qualquer tela. O 401 de uma
  // requisição feita com um token que o host já trocou é ignorado: o token atual pode estar válido.
  const firedFor = useRef<string | null>(null);
  const [expiredToken, setExpiredToken] = useState<string | null>(null);
  const notifyExpired = useCallback(
    (used: string) => {
      if (used !== tokenRef.current) return;
      setExpiredToken(used);
      if (firedFor.current !== used) {
        firedFor.current = used;
        emitTokenExpired();
      }
    },
    [emitTokenExpired],
  );
  const onMeExpired = useCallback(() => token && notifyExpired(token), [token, notifyExpired]);

  const { state, retry } = useMe(apiBase, token, onMeExpired);

  // Último usuário confirmado e o token que o confirmou. Renovar o token com o mesmo `sub` não desmonta as
  // telas nem perde o wizard; enquanto o /v1/me do token novo não responde, as telas ficam ocultas. Se o
  // token novo falhar sem nunca ter sido confirmado, o usuário anterior sai da tela (outro login pode ter
  // entrado no mesmo terminal).
  const [me, setMe] = useState<Me | null>(null);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  useEffect(() => {
    if (state.status === 'unconfigured') {
      setMe(null);
      setConfirmedFor(null);
    } else if (state.status === 'authenticated' && state.token === token) {
      setMe(state.me);
      setConfirmedFor(token);
    } else if (
      (state.status === 'expired' || state.status === 'unavailable') &&
      state.token === token &&
      confirmedFor !== token
    ) {
      setMe(null);
    }
  }, [state, token, confirmedFor]);
  const confirmed = me !== null && token !== null && confirmedFor === token;

  const api = useMemo(
    () => (apiBase && token ? createApi(apiBase, token, () => notifyExpired(token)) : null),
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
        {state.status === 'loading' && !confirmed && <p>Carregando…</p>}
        {expired && (
          <p role="alert" className="gc-notice gc-notice-error">
            Sessão expirada
          </p>
        )}
        {state.status === 'unavailable' && !confirmed && (
          <div role="alert">
            <p>Serviço indisponível no momento.</p>
            <button type="button" className="gc-button" onClick={retry}>
              Tentar de novo
            </button>
          </div>
        )}
        {confirmed && (
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
        <div hidden={!confirmed}>
          <ApiContext.Provider value={api}>
            <Shell key={me.sub} me={me} />
          </ApiContext.Provider>
        </div>
      )}
    </section>
  );
}
