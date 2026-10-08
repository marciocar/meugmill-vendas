import { useState } from 'react';
import { listAll, useApi } from '../api/client';
import type { Catalog, Portfolio, Ref, Seller } from '../api/types';
import { Field, Notice, useAsync } from '../ui';
import type { StepProps } from './step';

interface Pair {
  seller: Ref;
  productSubgroup: Ref;
}

const pairKey = (p: Pair) => `${p.seller.id}:${p.productSubgroup.id}`;

/** Etapa 3: pares vendedor x subgrupo. Grava o conjunto inteiro (`PUT /sellers`). */
export function StepSellers({ portfolio, editable, busy, write, next }: StepProps) {
  const api = useApi();
  const [pairs, setPairs] = useState<Pair[]>(portfolio.sellers);
  const [dirty, setDirty] = useState(false);
  const [sellerId, setSellerId] = useState('');
  const [subgroupId, setSubgroupId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const options = useAsync(async () => {
    const [sellers, subgroups] = await Promise.all([
      listAll<Seller>(api, '/v1/sellers', { active: true }),
      listAll<Catalog>(api, '/v1/product-subgroups', { active: true }),
    ]);
    // Só vendedor com vínculo ativo com a filial da carteira é aceito pela API.
    const usable = sellers.filter((s) => s.branches.some((b) => b.id === portfolio.branch.id && b.active));
    return { sellers: usable, subgroups };
  }, [api, portfolio.branch.id]);

  const readOnly = !editable;

  const add = () => {
    setError(null);
    const seller = options.data?.sellers.find((s) => s.id === Number(sellerId));
    const productSubgroup = options.data?.subgroups.find((s) => s.id === Number(subgroupId));
    if (!seller || !productSubgroup) return setError('Escolha o vendedor e o subgrupo.');
    const pair: Pair = {
      seller: { id: seller.id, code: seller.code, name: seller.name },
      productSubgroup: { id: productSubgroup.id, code: productSubgroup.code, name: productSubgroup.name },
    };
    if (pairs.some((p) => pairKey(p) === pairKey(pair))) return setError('Esse par já está na lista.');
    setPairs([...pairs, pair]);
    setDirty(true);
  };

  const save = async () => {
    if (readOnly || !dirty) return next();
    const assignments = pairs.map((p) => ({
      sellerId: p.seller.id,
      productSubgroupId: p.productSubgroup.id,
    }));
    const ok = await write(
      () =>
        api.send<Portfolio>('PUT', `/v1/portfolios/${portfolio.id}/sellers`, {
          body: { assignments },
          version: portfolio.version,
        }),
      'Vendedores salvos.',
    );
    if (ok) next();
  };

  return (
    <div className="gc-form">
      <p className="gc-muted">
        Cada subgrupo pode ter vários vendedores; a distribuição (etapa 5) divide os clientes entre eles.
      </p>
      <table className="gc-table" data-testid="seller-pairs">
        <thead>
          <tr>
            <th>Subgrupo</th>
            <th>Vendedor</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {[...pairs]
            .sort(
              (a, b) =>
                a.productSubgroup.code.localeCompare(b.productSubgroup.code) ||
                a.seller.code.localeCompare(b.seller.code),
            )
            .map((p) => (
              <tr key={pairKey(p)}>
                <td>
                  {p.productSubgroup.code} — {p.productSubgroup.name}
                </td>
                <td>
                  {p.seller.code} — {p.seller.name}
                </td>
                <td>
                  {!readOnly && (
                    <button
                      type="button"
                      className="gc-button gc-button-secondary"
                      onClick={() => {
                        setPairs(pairs.filter((x) => pairKey(x) !== pairKey(p)));
                        setDirty(true);
                      }}
                    >
                      Remover
                    </button>
                  )}
                </td>
              </tr>
            ))}
          {pairs.length === 0 && (
            <tr>
              <td colSpan={3} className="gc-muted">
                Nenhum vendedor.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!readOnly && (
        <div className="gc-toolbar">
          <Field label="Subgrupo">
            <select value={subgroupId} onChange={(e) => setSubgroupId(e.target.value)}>
              <option value="">Selecione</option>
              {(options.data?.subgroups ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vendedor" hint="Só vendedores ativos na filial da carteira.">
            <select value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
              <option value="">Selecione</option>
              {(options.data?.sellers ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </Field>
          <button type="button" className="gc-button gc-button-secondary" onClick={add}>
            Adicionar
          </button>
        </div>
      )}
      <Notice kind="error">{options.error ?? error}</Notice>
      <div className="gc-actions">
        <button type="button" className="gc-button" disabled={busy} onClick={() => void save()}>
          {readOnly || !dirty ? 'Próxima etapa' : 'Salvar e continuar'}
        </button>
      </div>
    </div>
  );
}
