import { useState } from 'react';
import { useApi } from '../api/client';
import type { Page, PortfolioSummary } from '../api/types';
import { isAdmin } from '../roles';
import { Badge, Field, LoadMore, Notice, useDebounced, usePaged } from '../ui';
import type { Me } from '../use-me';
import { Wizard } from './Wizard';

type Editing = { id: number | null } | null;

/** Lista de carteiras e entrada do wizard (nova ou existente). */
export function PortfoliosView({ me }: { me: Me }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [listKey, setListKey] = useState(0);

  if (editing) {
    return (
      <Wizard
        me={me}
        portfolioId={editing.id}
        onClose={() => {
          setEditing(null);
          setListKey((k) => k + 1);
        }}
      />
    );
  }
  return <PortfolioList key={listKey} me={me} onOpen={(id) => setEditing({ id })} />;
}

function PortfolioList({ me, onOpen }: { me: Me; onOpen: (id: number | null) => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [active, setActive] = useState('true');
  const query = useDebounced(q.trim());
  const paged = usePaged(
    (cursor) =>
      api.get<Page<PortfolioSummary>>('/v1/portfolios', { q: query, status, active, cursor, limit: 50 }),
    [api, query, status, active],
  );

  return (
    <div>
      <div className="gc-title-row">
        <h2>Carteiras</h2>
        {isAdmin(me) && (
          <button type="button" className="gc-button" onClick={() => onOpen(null)}>
            Nova carteira
          </button>
        )}
      </div>
      <div className="gc-toolbar">
        <Field label="Buscar">
          <input
            type="search"
            value={q}
            placeholder="Nome da carteira"
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
        <Field label="Situação">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option>
            <option value="draft">Rascunho</option>
            <option value="active">Finalizada</option>
          </select>
        </Field>
        <Field label="Ativa">
          <select value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="true">Ativas</option>
            <option value="false">Inativas</option>
            <option value="">Todas</option>
          </select>
        </Field>
      </div>
      <Notice kind="error">{paged.error}</Notice>
      <table className="gc-table" data-testid="portfolio-list">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Filial</th>
            <th>Tipo</th>
            <th>Responsável</th>
            <th>Situação</th>
            <th>Vendedores</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {paged.items.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.branch.code}</td>
              <td>{p.type.name}</td>
              <td>{p.responsibleSub}</td>
              <td>
                <StatusBadges status={p.status} active={p.active} />
              </td>
              <td>{p.sellersCount}</td>
              <td>
                <button type="button" className="gc-button gc-button-secondary" onClick={() => onOpen(p.id)}>
                  Abrir
                </button>
              </td>
            </tr>
          ))}
          {!paged.loading && paged.items.length === 0 && (
            <tr>
              <td colSpan={7} className="gc-muted">
                Nenhuma carteira encontrada.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <LoadMore paged={paged} />
    </div>
  );
}

export function StatusBadges({ status, active }: { status: 'draft' | 'active'; active: boolean }) {
  return (
    <>
      {status === 'active' ? <Badge tone="ok">Finalizada</Badge> : <Badge>Rascunho</Badge>}
      {!active && <Badge tone="bad">Inativa</Badge>}
    </>
  );
}
