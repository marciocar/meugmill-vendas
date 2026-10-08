import { useState } from 'react';
import { useApi } from '../api/client';
import type { Page, Visibility, VisibleCustomer } from '../api/types';
import { Field, LoadMore, Notice, formatCnpj, useAsync, useDebounced, usePaged, useTabShown } from '../ui';

const MODE_TEXT: Record<Visibility['mode'], string> = {
  profiles: 'Visibilidade pelos seus perfis.',
  legacy: 'Seu login não tem perfil conhecido: você vê os clientes das suas filiais (modo de transição).',
  denied: 'Seu login não tem perfil conhecido: nenhum cliente visível.',
};

/** Clientes que o usuário enxerga (E8): o vendedor vê os clientes ligados a ele. */
export function MyCustomersView() {
  const api = useApi();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const shown = useTabShown();
  const summary = useAsync(() => api.get<Visibility>('/v1/me/visibility'), [api, shown]);
  const paged = usePaged(
    (cursor) => api.get<Page<VisibleCustomer>>('/v1/me/customers', { q: query, cursor, limit: 50 }),
    [api, query, shown],
  );

  return (
    <div>
      <h2>Meus clientes</h2>
      <Notice kind="error">{summary.error}</Notice>
      {summary.data && (
        <p className="gc-muted" data-testid="visibility-summary">
          {MODE_TEXT[summary.data.mode]} Perfis: {summary.data.profiles.join(', ') || 'nenhum'}.
          {summary.data.seller && ` Vendedor ligado: ${summary.data.seller.code}.`} Clientes visíveis:{' '}
          {summary.data.visibleCustomers}.
        </p>
      )}
      <div className="gc-toolbar">
        <Field label="Buscar">
          <input
            type="search"
            maxLength={100}
            value={q}
            placeholder="Razão social, fantasia ou CNPJ"
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
      </div>
      <Notice kind="error">{paged.error}</Notice>
      <table className="gc-table">
        <thead>
          <tr>
            <th>CNPJ</th>
            <th>Razão social</th>
            <th>Nome fantasia</th>
            <th>Bairro</th>
          </tr>
        </thead>
        <tbody>
          {paged.items.map((c) => (
            <tr key={c.id}>
              <td>{formatCnpj(c.cnpj)}</td>
              <td>{c.legalName}</td>
              <td>{c.tradeName ?? '—'}</td>
              <td>{c.neighborhood ?? '—'}</td>
            </tr>
          ))}
          {!paged.loading && paged.items.length === 0 && (
            <tr>
              <td colSpan={4} className="gc-muted">
                Nenhum cliente visível.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <LoadMore paged={paged} />
    </div>
  );
}
