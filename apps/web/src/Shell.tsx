import { useState } from 'react';
import { ErrorBoundary } from './ui';
import type { Me } from './use-me';
import { PortfoliosView } from './portfolios/PortfoliosView';
import { MyCustomersView } from './visibility/MyCustomersView';
import { CsvView } from './csv/CsvView';

type Tab = 'portfolios' | 'my-customers' | 'csv';

const TABS: { id: Tab; label: string }[] = [
  { id: 'portfolios', label: 'Carteiras' },
  { id: 'my-customers', label: 'Meus clientes' },
  { id: 'csv', label: 'Importar e exportar' },
];

/** Navegação interna por abas: o componente não mexe na URL do host. */
export function Shell({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>('portfolios');
  return (
    <div className="gc-shell">
      <nav className="gc-tabs" role="tablist" aria-label="Seções">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`gc-tab${tab === t.id ? ' gc-tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div role="tabpanel" className="gc-panel">
        <ErrorBoundary key={tab}>
          {tab === 'portfolios' && <PortfoliosView me={me} />}
          {tab === 'my-customers' && <MyCustomersView />}
          {tab === 'csv' && <CsvView me={me} />}
        </ErrorBoundary>
      </div>
    </div>
  );
}
