import { useState } from 'react';
import { ErrorBoundary, TabShownContext } from './ui';
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
  // As abas já visitadas ficam montadas (só escondidas): trocar de aba não descarta o wizard em edição.
  const [visited, setVisited] = useState<Tab[]>(['portfolios']);
  const [shown, setShown] = useState<Record<Tab, number>>({ portfolios: 0, 'my-customers': 0, csv: 0 });
  const open = (t: Tab) => {
    if (t !== tab) setShown((s) => ({ ...s, [t]: s[t] + 1 }));
    setTab(t);
    setVisited((v) => (v.includes(t) ? v : [...v, t]));
  };
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
            onClick={() => open(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {TABS.filter((t) => visited.includes(t.id)).map((t) => (
        <div key={t.id} role="tabpanel" className="gc-panel" hidden={tab !== t.id}>
          <TabShownContext.Provider value={shown[t.id]}>
            <ErrorBoundary>
              {t.id === 'portfolios' && <PortfoliosView me={me} />}
              {t.id === 'my-customers' && <MyCustomersView />}
              {t.id === 'csv' && <CsvView me={me} />}
            </ErrorBoundary>
          </TabShownContext.Provider>
        </div>
      ))}
    </div>
  );
}
