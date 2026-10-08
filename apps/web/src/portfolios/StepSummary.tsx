import { formatDateTime } from '../ui';
import type { StepProps } from './step';

const LEVEL_TEXT = { state: 'Estado', municipality: 'Município', neighborhood: 'Bairro' } as const;

/** Etapa 4: leitura do agregado completo, com atalho para cada etapa. */
export function StepSummary({ portfolio: p, next, goTo }: StepProps & { goTo: (step: number) => void }) {
  const edit = (step: number) => (
    <button type="button" className="gc-link" onClick={() => goTo(step)}>
      ver etapa
    </button>
  );
  return (
    <div className="gc-summary" data-testid="summary">
      <section>
        <h3>Informações {edit(0)}</h3>
        <dl className="gc-dl">
          <dt>Filial</dt>
          <dd>
            {p.branch.code} — {p.branch.name}
          </dd>
          <dt>Tipo</dt>
          <dd>{p.type.name}</dd>
          <dt>Responsável</dt>
          <dd>{p.responsibleSub}</dd>
          <dt>Descrição</dt>
          <dd>{p.description || '—'}</dd>
          <dt>Última finalização</dt>
          <dd>{formatDateTime(p.finalizedAt)}</dd>
        </dl>
      </section>
      <section>
        <h3>Filtros {edit(1)}</h3>
        <ul>
          {p.filters.regions.map((r, i) => (
            <li key={i}>
              {LEVEL_TEXT[r.level]}:{' '}
              {[r.uf, r.municipalityName, r.neighborhoodLabel].filter(Boolean).join(' / ')}
            </li>
          ))}
          {p.filters.retailNetworks.map((n) => (
            <li key={`n${n.id}`}>Rede: {n.name}</li>
          ))}
          {p.filters.economicGroups.map((g) => (
            <li key={`g${g.id}`}>Grupo econômico: {g.name}</li>
          ))}
          {p.filters.regions.length + p.filters.retailNetworks.length + p.filters.economicGroups.length ===
            0 && <li className="gc-muted">Sem filtro: só clientes incluídos à mão.</li>}
        </ul>
      </section>
      <section>
        <h3>Vendedores {edit(2)}</h3>
        <ul>
          {p.sellers.map((s) => (
            <li key={`${s.seller.id}:${s.productSubgroup.id}`}>
              {s.productSubgroup.name}: {s.seller.code} — {s.seller.name}
            </li>
          ))}
          {p.sellers.length === 0 && <li className="gc-muted">Nenhum vendedor.</li>}
        </ul>
      </section>
      {(p.overridesInclude !== undefined || p.conflictsBlocked !== undefined) && (
        <section>
          <h3>Clientes</h3>
          <dl className="gc-dl">
            {p.overridesInclude !== undefined && (
              <>
                <dt>Ajustes manuais</dt>
                <dd>
                  {p.overridesInclude} inclusão(ões), {p.overridesExclude ?? 0} exclusão(ões)
                </dd>
              </>
            )}
            {p.conflictsBlocked !== undefined && (
              <>
                <dt>Conflitos com outras carteiras</dt>
                <dd>
                  {p.conflictsBlocked} bloqueado(s) por empate, {p.conflictsLost ?? 0} perdido(s) para outra
                  carteira
                </dd>
              </>
            )}
          </dl>
        </section>
      )}
      <div className="gc-actions">
        <button type="button" className="gc-button" onClick={next}>
          Próxima etapa
        </button>
      </div>
    </div>
  );
}
