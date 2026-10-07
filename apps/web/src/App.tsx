import { Dropdown } from './Dropdown';
import { useHost } from './host-context';

interface AppProps {
  apiBase: string | null;
  token: string | null;
}

/** UI mínima da Fase 1. O token nunca é exibido, apenas sua presença. */
export function App({ apiBase, token }: AppProps) {
  const { emitTokenExpired } = useHost();
  return (
    <section className="gc-root">
      <h1>Carteira de Clientes</h1>
      <p data-testid="api-base">API: {apiBase ? <code>{apiBase}</code> : 'não configurada'}</p>
      <p data-testid="token-status">Token: {token ? 'presente' : 'ausente'}</p>
      <Dropdown label="Ações">
        <li role="none">
          <button type="button" role="menuitem" className="gc-menu-item" onClick={emitTokenExpired}>
            Simular token expirado
          </button>
        </li>
      </Dropdown>
    </section>
  );
}
