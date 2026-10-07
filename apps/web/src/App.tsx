import { Dropdown } from './Dropdown';
import { useHost } from './host-context';
import { useMe } from './use-me';

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
  const { state, retry } = useMe(apiBase, token, emitTokenExpired);

  return (
    <section className="gc-root">
      <h1>Carteira de Clientes</h1>
      <div aria-live="polite" data-testid="status">
        {state.status === 'unconfigured' && <p>Configure a API e o token para carregar a carteira.</p>}
        {state.status === 'loading' && <p>Carregando…</p>}
        {state.status === 'authenticated' && (
          <dl className="gc-me">
            <dt>Usuário</dt>
            <dd data-testid="me-sub">{state.me.sub}</dd>
            <dt>Perfis</dt>
            <dd data-testid="me-roles">{list(state.me.roles)}</dd>
            <dt>Filiais</dt>
            <dd data-testid="me-branches">{list(state.me.branchIds)}</dd>
          </dl>
        )}
        {state.status === 'expired' && <p role="alert">Sessão expirada</p>}
        {state.status === 'unavailable' && (
          <div role="alert">
            <p>Serviço indisponível no momento.</p>
            <button type="button" className="gc-button" onClick={retry}>
              Tentar de novo
            </button>
          </div>
        )}
      </div>
      <Dropdown label="Ações">
        {debug && (
          <li role="none">
            <button type="button" role="menuitem" className="gc-menu-item" onClick={emitTokenExpired}>
              Simular token expirado
            </button>
          </li>
        )}
      </Dropdown>
    </section>
  );
}
