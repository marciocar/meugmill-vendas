import { useMemo, useState } from 'react';
import { listAll, useApi } from '../api/client';
import type { Catalog, Municipality, Page, Portfolio, RegionInput, RegionLevel, State } from '../api/types';
import { Field, Notice, useAsync, useDebounced } from '../ui';
import { useReportDirty, type StepProps } from './step';

interface DraftRegion extends RegionInput {
  /** Texto exibido (UF, município, bairro). */
  label: string;
}

const LEVEL_TEXT: Record<RegionLevel, string> = {
  state: 'Estado',
  municipality: 'Município',
  neighborhood: 'Bairro',
};

const keyOf = (r: RegionInput) =>
  `${r.level}|${r.stateCode}|${r.municipalityCode ?? ''}|${(r.neighborhoodLabel ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()}`;

const toInput = (r: DraftRegion): RegionInput => ({
  level: r.level,
  stateCode: r.stateCode,
  ...(r.municipalityCode !== undefined ? { municipalityCode: r.municipalityCode } : {}),
  ...(r.neighborhoodLabel !== undefined ? { neighborhoodLabel: r.neighborhoodLabel } : {}),
});

/** Etapa 2: regiões, redes e grupos econômicos. Grava o conjunto inteiro (`PUT /filters`). */
export function StepFilters({ portfolio, editable, busy, write, next, onDirty }: StepProps) {
  const api = useApi();
  const [regions, setRegions] = useState<DraftRegion[]>(() =>
    portfolio.filters.regions.map((r) => ({
      level: r.level,
      stateCode: r.stateCode,
      ...(r.municipalityCode !== undefined ? { municipalityCode: r.municipalityCode } : {}),
      ...(r.neighborhoodLabel !== undefined ? { neighborhoodLabel: r.neighborhoodLabel } : {}),
      label: [r.uf, r.municipalityName, r.neighborhoodLabel].filter(Boolean).join(' / '),
    })),
  );
  const [networkIds, setNetworkIds] = useState<number[]>(portfolio.filters.retailNetworks.map((n) => n.id));
  const [groupIds, setGroupIds] = useState<number[]>(portfolio.filters.economicGroups.map((g) => g.id));
  const [dirty, setDirty] = useState(false);
  useReportDirty(dirty, onDirty);

  const catalogs = useAsync(async () => {
    const [networks, groups] = await Promise.all([
      listAll<Catalog>(api, '/v1/retail-networks', { active: true }),
      listAll<Catalog>(api, '/v1/economic-groups', { active: true }),
    ]);
    return { networks, groups };
  }, [api]);

  const readOnly = !editable;

  const save = async () => {
    if (readOnly || !dirty) return next();
    const body = {
      regions: regions.map(toInput),
      retailNetworkIds: networkIds,
      economicGroupIds: groupIds,
    };
    const ok = await write(
      () =>
        api.send<Portfolio>('PUT', `/v1/portfolios/${portfolio.id}/filters`, {
          body,
          version: portfolio.version,
        }),
      'Filtros salvos.',
    );
    if (ok) next();
  };

  const change =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  return (
    <div className="gc-form">
      <p className="gc-muted">
        Dentro de cada critério vale <strong>qualquer um</strong>; entre critérios preenchidos valem{' '}
        <strong>todos</strong>. Sem filtro, a carteira só tem os clientes incluídos à mão.
      </p>
      <fieldset className="gc-fieldset">
        <legend>Regiões</legend>
        <ul className="gc-chips" data-testid="regions">
          {regions.map((r) => (
            <li key={keyOf(r)} className="gc-chip">
              <span>
                {LEVEL_TEXT[r.level]}: {r.label}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  className="gc-chip-remove"
                  aria-label={`Remover ${r.label}`}
                  onClick={() => change(setRegions)(regions.filter((x) => keyOf(x) !== keyOf(r)))}
                >
                  ×
                </button>
              )}
            </li>
          ))}
          {regions.length === 0 && <li className="gc-muted">Nenhuma região.</li>}
        </ul>
        {!readOnly && (
          <RegionAdder
            onAdd={(r) => {
              if (regions.some((x) => keyOf(x) === keyOf(r))) return 'Essa região já está na lista.';
              change(setRegions)([...regions, r]);
              return null;
            }}
          />
        )}
      </fieldset>
      <Notice kind="error">{catalogs.error}</Notice>
      <CheckList
        legend="Redes"
        options={withCurrent(catalogs.data?.networks ?? [], portfolio.filters.retailNetworks)}
        selected={networkIds}
        disabled={readOnly}
        onChange={change(setNetworkIds)}
      />
      <CheckList
        legend="Grupos econômicos"
        options={withCurrent(catalogs.data?.groups ?? [], portfolio.filters.economicGroups)}
        selected={groupIds}
        disabled={readOnly}
        onChange={change(setGroupIds)}
      />
      <div className="gc-actions">
        <button type="button" className="gc-button" disabled={busy} onClick={() => void save()}>
          {readOnly || !dirty ? 'Próxima etapa' : 'Salvar e continuar'}
        </button>
      </div>
    </div>
  );
}

/** Opções ativas mais as já gravadas (que podem ter sido inativadas depois). */
function withCurrent(
  options: { id: number; code: string; name: string }[],
  current: { id: number; code: string; name: string }[],
) {
  const ids = new Set(options.map((o) => o.id));
  return [...current.filter((c) => !ids.has(c.id)), ...options];
}

function RegionAdder({ onAdd }: { onAdd: (r: DraftRegion) => string | null }) {
  const api = useApi();
  const [level, setLevel] = useState<RegionLevel>('state');
  const [uf, setUf] = useState('');
  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [search, setSearch] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(search.trim());

  const states = useAsync(() => api.get<State[]>('/v1/geo/states'), [api]);
  const state = useMemo(() => states.data?.find((s) => s.uf === uf) ?? null, [states.data, uf]);
  const municipalities = useAsync(
    async () =>
      level === 'state' || !uf
        ? []
        : (await api.get<Page<Municipality>>('/v1/geo/municipalities', { uf, q, limit: 20 })).items,
    [api, uf, q, level],
  );

  const add = () => {
    setError(null);
    if (!state) return setError('Escolha o estado.');
    let region: DraftRegion;
    if (level === 'state') {
      region = { level, stateCode: state.ibgeCode, label: state.uf };
    } else {
      if (!municipality) return setError('Escolha o município.');
      if (level === 'municipality') {
        region = {
          level,
          stateCode: state.ibgeCode,
          municipalityCode: municipality.ibgeCode,
          label: `${state.uf} / ${municipality.name}`,
        };
      } else {
        const label = neighborhood.trim();
        if (!/[\p{L}\p{N}]/u.test(label)) return setError('Informe o bairro.');
        if (label.includes('|')) return setError('O bairro não pode ter o caractere |.');
        region = {
          level,
          stateCode: state.ibgeCode,
          municipalityCode: municipality.ibgeCode,
          neighborhoodLabel: label,
          label: `${state.uf} / ${municipality.name} / ${label}`,
        };
      }
    }
    const problem = onAdd(region);
    if (problem) return setError(problem);
    setNeighborhood('');
  };

  return (
    <div className="gc-toolbar">
      <Field label="Nível">
        <select value={level} onChange={(e) => setLevel(e.target.value as RegionLevel)}>
          <option value="state">Estado</option>
          <option value="municipality">Município</option>
          <option value="neighborhood">Bairro</option>
        </select>
      </Field>
      <Field label="Estado">
        <select
          value={uf}
          onChange={(e) => {
            setUf(e.target.value);
            setMunicipality(null);
          }}
        >
          <option value="">Selecione</option>
          {(states.data ?? []).map((s) => (
            <option key={s.ibgeCode} value={s.uf}>
              {s.uf} — {s.name}
            </option>
          ))}
        </select>
      </Field>
      {level !== 'state' && (
        <>
          <Field label="Buscar município">
            <input type="search" value={search} disabled={!uf} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label="Município">
            <select
              value={municipality?.ibgeCode ?? ''}
              disabled={!uf}
              onChange={(e) =>
                setMunicipality(
                  municipalities.data?.find((m) => m.ibgeCode === Number(e.target.value)) ?? null,
                )
              }
            >
              <option value="">Selecione</option>
              {municipality && !municipalities.data?.some((m) => m.ibgeCode === municipality.ibgeCode) && (
                <option value={municipality.ibgeCode}>{municipality.name}</option>
              )}
              {(municipalities.data ?? []).map((m) => (
                <option key={m.ibgeCode} value={m.ibgeCode}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {level === 'neighborhood' && (
        <Field label="Bairro">
          <input value={neighborhood} maxLength={120} onChange={(e) => setNeighborhood(e.target.value)} />
        </Field>
      )}
      <button type="button" className="gc-button gc-button-secondary" onClick={add}>
        Adicionar região
      </button>
      <Notice kind="error">{error}</Notice>
    </div>
  );
}

function CheckList({
  legend,
  options,
  selected,
  disabled,
  onChange,
}: {
  legend: string;
  options: { id: number; code: string; name: string }[];
  selected: number[];
  disabled: boolean;
  onChange: (ids: number[]) => void;
}) {
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const visible = f ? options.filter((o) => `${o.code} ${o.name}`.toLowerCase().includes(f)) : options;
  return (
    <fieldset className="gc-fieldset">
      <legend>
        {legend} ({selected.length} selecionado{selected.length === 1 ? '' : 's'})
      </legend>
      {options.length > 8 && (
        <input
          type="search"
          className="gc-filter"
          placeholder={`Filtrar ${legend.toLowerCase()}`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div className="gc-checklist">
        {visible.map((o) => (
          <label key={o.id} className="gc-check">
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              disabled={disabled}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, o.id] : selected.filter((id) => id !== o.id))
              }
            />
            {o.code} — {o.name}
          </label>
        ))}
        {options.length === 0 && <span className="gc-muted">Nenhum cadastro ativo.</span>}
      </div>
    </fieldset>
  );
}
