import { useState } from 'react';
import { useApi } from '../api/client';
import type {
  AssignmentCell,
  AssignmentSummary,
  CellStatus,
  DistributeResult,
  FinalizeResult,
  Overrides,
  Page,
  Portfolio,
  PreviewItem,
  Resolution,
} from '../api/types';
import { canSeePortfolioDetails } from '../roles';
import {
  Badge,
  Field,
  LoadMore,
  Notice,
  formatCnpj,
  formatDateTime,
  plural,
  useAsync,
  useDebounced,
  usePaged,
} from '../ui';
import type { StepProps } from './step';

type Panel = 'preview' | 'distribution' | 'finalize';

const PANELS: { id: Panel; label: string }[] = [
  { id: 'preview', label: 'Prévia e ajustes' },
  { id: 'distribution', label: 'Distribuição' },
  { id: 'finalize', label: 'Finalizar' },
];

/** Etapa 5: quem entra na carteira (E4/E5), quem atende cada cliente (E6) e a gravação dos vínculos (E7). */
export function StepCustomers(props: StepProps) {
  const [panel, setPanel] = useState<Panel>('preview');
  if (!canSeePortfolioDetails(props.me, props.portfolio)) {
    return (
      <Notice kind="info">
        Os clientes desta carteira ficam disponíveis só para o responsável, a administração e a supervisão.
      </Notice>
    );
  }
  return (
    <div>
      <div className="gc-subtabs" role="tablist" aria-label="Clientes">
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={panel === p.id}
            className={`gc-tab${panel === p.id ? ' gc-tab-active' : ''}`}
            onClick={() => setPanel(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {panel === 'preview' && <PreviewPanel {...props} />}
      {panel === 'distribution' && <DistributionPanel {...props} />}
      {panel === 'finalize' && <FinalizePanel {...props} />}
    </div>
  );
}

const RESOLUTION: Record<Resolution, { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  assigned: { text: 'Nesta carteira', tone: 'ok' },
  lost: { text: 'Em outra carteira', tone: 'warn' },
  blocked: { text: 'Empate', tone: 'bad' },
};
/** Até 2 nomes e o total do resto: uma filial com muitas carteiras não pode virar um paredão de texto. */
export function competitorsText(names: string[]): string {
  if (names.length <= 2) return names.join(' e ');
  return `${names.slice(0, 2).join(', ')} e mais ${names.length - 2}`;
}

const LEVEL = { state: 'estado', municipality: 'município', neighborhood: 'bairro' } as const;

function PreviewPanel({ portfolio, editable, busy, write }: StepProps) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [resolution, setResolution] = useState('');
  const query = useDebounced(q.trim());
  const base = `/v1/portfolios/${portfolio.id}`;

  // Os ajustes guardam a versão da carteira em que foram lidos: o PUT substitui o conjunto inteiro, então só se
  // escreve a partir de uma leitura da versão atual (senão um clique rápido apagaria o ajuste anterior).
  const overrides = useAsync(
    async () => ({ version: portfolio.version, ...(await api.get<Overrides>(`${base}/overrides`)) }),
    [api, base, portfolio.version],
  );
  const preview = usePaged(
    (cursor) =>
      api.get<Page<PreviewItem>>(`${base}/preview`, { q: query, source, resolution, cursor, limit: 50 }),
    [api, base, portfolio.version, query, source, resolution],
  );

  const include = overrides.data?.include.map((o) => o.customer.id) ?? [];
  const exclude = overrides.data?.exclude.map((o) => o.customer.id) ?? [];
  // Os botões ficam na tela (a busca de inclusão não se perde) e só se habilitam com a lista em dia.
  const canWrite = editable && !busy && !overrides.loading && overrides.data?.version === portfolio.version;

  const saveOverrides = (nextInclude: number[], nextExclude: number[], success: string) =>
    write(
      () =>
        api.send<Portfolio>('PUT', `${base}/overrides`, {
          body: { include: nextInclude, exclude: nextExclude },
          version: portfolio.version,
        }),
      success,
    );

  return (
    <div>
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
        <Field label="Origem">
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Todas</option>
            <option value="filter">Pelos filtros</option>
            <option value="manual">Incluídos à mão</option>
          </select>
        </Field>
        <Field label="Disputa">
          <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
            <option value="">Todas</option>
            <option value="assigned">Nesta carteira</option>
            <option value="lost">Em outra carteira</option>
            <option value="blocked">Empate</option>
          </select>
        </Field>
      </div>
      <Notice kind="error">{preview.error ?? overrides.error}</Notice>
      <table className="gc-table" data-testid="preview">
        <thead>
          <tr>
            <th>CNPJ</th>
            <th>Razão social</th>
            <th>Município</th>
            <th>Origem</th>
            <th>Disputa</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {preview.items.map((item) => {
            const c = item.customer;
            const r = RESOLUTION[item.resolution];
            return (
              <tr key={c.id}>
                <td>{formatCnpj(c.cnpj)}</td>
                <td>{c.legalName}</td>
                <td>{c.municipalityName ?? '—'}</td>
                <td>
                  {item.source === 'manual'
                    ? 'Incluído à mão'
                    : `Filtro${item.matchedRegionLevel ? ` (${LEVEL[item.matchedRegionLevel]})` : ''}`}
                </td>
                <td>
                  <Badge tone={r.tone}>{r.text}</Badge>
                  {item.competitors.length > 0 && (
                    <span className="gc-muted" title={item.competitors.map((x) => x.name).join(', ')}>
                      {' '}
                      com {competitorsText(item.competitors.map((x) => x.name))}
                    </span>
                  )}
                </td>
                <td>
                  {editable && item.source === 'filter' && (
                    <button
                      type="button"
                      className="gc-button gc-button-secondary"
                      disabled={!canWrite}
                      onClick={() =>
                        void saveOverrides(
                          include.filter((id) => id !== c.id),
                          [...exclude, c.id],
                          'Cliente excluído da carteira.',
                        )
                      }
                    >
                      Excluir
                    </button>
                  )}
                  {editable && item.source === 'manual' && (
                    <button
                      type="button"
                      className="gc-button gc-button-secondary"
                      disabled={!canWrite}
                      onClick={() =>
                        void saveOverrides(
                          include.filter((id) => id !== c.id),
                          exclude,
                          'Inclusão desfeita.',
                        )
                      }
                    >
                      Remover inclusão
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {!preview.loading && preview.items.length === 0 && (
            <tr>
              <td colSpan={6} className="gc-muted">
                Nenhum cliente na prévia.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <LoadMore paged={preview} />

      {overrides.data && overrides.data.exclude.length > 0 && (
        <section>
          <h3>Excluídos à mão</h3>
          <ul className="gc-list">
            {overrides.data.exclude.map((o) => (
              <li key={o.customer.id}>
                {formatCnpj(o.customer.cnpj)} — {o.customer.legalName}
                {!o.effective && <span className="gc-muted"> (sem efeito: não casa mais os filtros)</span>}
                {editable && (
                  <button
                    type="button"
                    className="gc-link"
                    disabled={!canWrite}
                    onClick={() =>
                      void saveOverrides(
                        include,
                        exclude.filter((id) => id !== o.customer.id),
                        'Exclusão desfeita.',
                      )
                    }
                  >
                    desfazer
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {overrides.data && overrides.data.include.some((o) => !o.effective) && (
        <Notice kind="info">
          Há inclusões sem efeito (cliente inativo ou sem vínculo ativo com a filial). Elas ficam gravadas,
          mas não entram na carteira.
        </Notice>
      )}
      {editable && (
        <IncludeCustomer
          busy={!canWrite}
          isIncluded={(id) => include.includes(id)}
          onInclude={(id) =>
            void saveOverrides(
              [...include, id],
              exclude.filter((x) => x !== id),
              'Cliente incluído na carteira.',
            )
          }
        />
      )}
    </div>
  );
}

function IncludeCustomer({
  busy,
  isIncluded,
  onInclude,
}: {
  busy: boolean;
  isIncluded: (id: number) => boolean;
  onInclude: (id: number) => void;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const results = useAsync(
    async () =>
      query.length < 3
        ? []
        : (
            await api.get<Page<{ id: number; cnpj: string; legalName: string; active: boolean }>>(
              '/v1/customers',
              {
                q: query,
                active: true,
                limit: 10,
              },
            )
          ).items,
    [api, query],
  );
  return (
    <section>
      <h3>Incluir cliente à mão</h3>
      <Field
        label="Buscar cliente"
        hint="Pelo menos 3 caracteres. Só clientes ativos com vínculo ativo na filial da carteira."
      >
        <input type="search" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      <Notice kind="error">{results.error}</Notice>
      <ul className="gc-list">
        {(results.data ?? []).map((c) => (
          <li key={c.id}>
            {formatCnpj(c.cnpj)} — {c.legalName}{' '}
            {isIncluded(c.id) ? (
              <span className="gc-muted">(já incluído)</span>
            ) : (
              <button type="button" className="gc-link" disabled={busy} onClick={() => onInclude(c.id)}>
                incluir
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const CELL_STATUS: Record<CellStatus, { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  assigned: { text: 'Atribuído', tone: 'ok' },
  unassigned: { text: 'Sem vendedor', tone: 'warn' },
  stale: { text: 'Vendedor inválido', tone: 'bad' },
};

function DistributionPanel({ portfolio, editable, busy, write }: StepProps) {
  const api = useApi();
  const base = `/v1/portfolios/${portfolio.id}`;
  const [status, setStatus] = useState('');
  const [subgroupId, setSubgroupId] = useState('');
  const [result, setResult] = useState<DistributeResult | null>(null);

  const summary = useAsync(
    () => api.get<AssignmentSummary>(`${base}/assignments/summary`),
    [api, base, portfolio.version],
  );
  const cells = usePaged(
    (cursor) =>
      api.get<Page<AssignmentCell>>(`${base}/assignments`, {
        status,
        productSubgroupId: subgroupId,
        cursor,
        limit: 50,
      }),
    [api, base, portfolio.version, status, subgroupId],
  );

  const sellersOf = (productSubgroupId: number) =>
    portfolio.sellers.filter((s) => s.productSubgroup.id === productSubgroupId).map((s) => s.seller);

  const distribute = () =>
    write(async () => {
      const r = await api.send<DistributeResult>('POST', `${base}/distribute`, {
        body: {},
        version: portfolio.version,
      });
      setResult(r);
      return r.portfolio;
    });

  const setCell = (cell: AssignmentCell, sellerId: number | null) =>
    write(
      () =>
        api.send<Portfolio>('PUT', `${base}/assignments`, {
          body:
            sellerId === null
              ? { clear: [{ customerId: cell.customer.id, productSubgroupId: cell.productSubgroup.id }] }
              : {
                  set: [
                    { customerId: cell.customer.id, productSubgroupId: cell.productSubgroup.id, sellerId },
                  ],
                },
          version: portfolio.version,
        }),
      sellerId === null ? 'Atribuição removida.' : 'Vendedor atribuído.',
    );

  const totals = summary.data?.totals;
  const distributedCount = result ? Object.values(result.distributed).reduce((a, b) => a + b, 0) : 0;

  return (
    <div>
      <Notice kind="error">{summary.error}</Notice>
      {totals && (
        <p data-testid="distribution-totals">
          {plural(totals.members, 'cliente', 'clientes')} × subgrupos ={' '}
          {plural(totals.cells, 'célula', 'células')}: {totals.assigned} atribuída(s), {totals.unassigned} sem
          vendedor, {totals.stale} com vendedor inválido.
        </p>
      )}
      {summary.data && summary.data.subgroups.length > 0 && (
        <table className="gc-table">
          <thead>
            <tr>
              <th>Subgrupo</th>
              <th>Clientes por vendedor</th>
              <th>Sem vendedor</th>
              <th>Inválidos</th>
            </tr>
          </thead>
          <tbody>
            {summary.data.subgroups.map((s) => (
              <tr key={s.productSubgroup.id}>
                <td>{s.productSubgroup.name}</td>
                <td>{s.sellers.map((x) => `${x.seller.code}: ${x.count}`).join(' · ') || '—'}</td>
                <td>{s.unassigned}</td>
                <td>{s.stale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editable && (
        <div className="gc-actions">
          <button type="button" className="gc-button" disabled={busy} onClick={() => void distribute()}>
            Distribuir automaticamente
          </button>
          <span className="gc-muted">
            Preenche só as células sem vendedor válido, equilibrando entre os vendedores.
          </span>
        </div>
      )}
      {result && (
        <Notice kind="success">
          {distributedCount === 0
            ? 'Nada a distribuir: todas as células já tinham vendedor válido.'
            : `${plural(distributedCount, 'célula distribuída', 'células distribuídas')}.`}
          {result.skippedSubgroupIds.length > 0 &&
            ` ${plural(result.skippedSubgroupIds.length, 'subgrupo ficou', 'subgrupos ficaram')} sem vendedor utilizável.`}
        </Notice>
      )}
      <div className="gc-toolbar">
        <Field label="Situação">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option>
            <option value="unassigned">Sem vendedor</option>
            <option value="stale">Vendedor inválido</option>
            <option value="assigned">Atribuídas</option>
          </select>
        </Field>
        <Field label="Subgrupo">
          <select value={subgroupId} onChange={(e) => setSubgroupId(e.target.value)}>
            <option value="">Todos</option>
            {(summary.data?.subgroups ?? []).map((s) => (
              <option key={s.productSubgroup.id} value={s.productSubgroup.id}>
                {s.productSubgroup.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Notice kind="error">{cells.error}</Notice>
      <table className="gc-table" data-testid="assignments">
        <thead>
          <tr>
            <th>CNPJ</th>
            <th>Razão social</th>
            <th>Subgrupo</th>
            <th>Vendedor</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {cells.items.map((cell) => {
            const st = CELL_STATUS[cell.status];
            const current = cell.status === 'assigned' && cell.seller ? String(cell.seller.id) : '';
            return (
              <tr key={`${cell.customer.id}:${cell.productSubgroup.id}`}>
                <td>{formatCnpj(cell.customer.cnpj)}</td>
                <td>{cell.customer.legalName}</td>
                <td>{cell.productSubgroup.name}</td>
                <td>
                  {editable ? (
                    <select
                      aria-label={`Vendedor de ${cell.customer.legalName} em ${cell.productSubgroup.name}`}
                      value={current}
                      disabled={busy}
                      onChange={(e) => void setCell(cell, e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">
                        {cell.status === 'stale' && cell.seller
                          ? `(inválido: ${cell.seller.code})`
                          : 'Sem vendedor'}
                      </option>
                      {sellersOf(cell.productSubgroup.id).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} — {s.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    (cell.seller && `${cell.seller.code} — ${cell.seller.name}`) || '—'
                  )}
                </td>
                <td>
                  <Badge tone={st.tone}>{st.text}</Badge>
                </td>
              </tr>
            );
          })}
          {!cells.loading && cells.items.length === 0 && (
            <tr>
              <td colSpan={5} className="gc-muted">
                Nenhuma célula. A grade é formada pelos clientes desta carteira × subgrupos dos vendedores.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <LoadMore paged={cells} />
    </div>
  );
}

function FinalizePanel({ portfolio, editable, busy, write }: StepProps) {
  const api = useApi();
  const base = `/v1/portfolios/${portfolio.id}`;
  const [result, setResult] = useState<FinalizeResult | null>(null);
  const summary = useAsync(
    () => api.get<AssignmentSummary>(`${base}/assignments/summary`),
    [api, base, portfolio.version],
  );
  const links = useAsync(
    async () => (await api.get<Page<unknown>>(`${base}/links`, { limit: 1 })).total ?? 0,
    [api, base, portfolio.version],
  );

  const totals = summary.data?.totals;
  const blocked = portfolio.conflictsBlocked ?? 0;
  const pending = totals ? totals.unassigned + totals.stale : 0;

  const finalize = () =>
    write(async () => {
      const r = await api.send<FinalizeResult>('POST', `${base}/finalize`, {
        body: {},
        version: portfolio.version,
      });
      setResult(r);
      return r.portfolio;
    }, 'Carteira finalizada: vínculos gravados.');

  return (
    <div>
      <p>
        Finalizar grava os vínculos cliente × subgrupo × vendedor e torna a carteira ativa. Ao finalizar de
        novo, só as diferenças mudam.
      </p>
      <Notice kind="error">{summary.error ?? links.error}</Notice>
      <dl className="gc-dl" data-testid="finalize-checks">
        <dt>Situação</dt>
        <dd>
          {portfolio.status === 'active'
            ? `Finalizada em ${formatDateTime(portfolio.finalizedAt)}`
            : 'Rascunho'}
        </dd>
        <dt>Vínculos ativos</dt>
        <dd>{links.data ?? '…'}</dd>
        <dt>Clientes</dt>
        <dd>{totals ? totals.members : '…'}</dd>
        <dt>Células sem vendedor válido</dt>
        <dd>{totals ? pending : '…'}</dd>
        {portfolio.conflictsBlocked !== undefined && (
          <>
            <dt>Clientes bloqueados por empate</dt>
            <dd>{blocked}</dd>
          </>
        )}
      </dl>
      {pending > 0 && <Notice kind="info">Distribua as células pendentes antes de finalizar.</Notice>}
      {blocked > 0 && (
        <Notice kind="info">
          Resolva os empates com outras carteiras (filtros ou ajustes) antes de finalizar.
        </Notice>
      )}
      {editable && (
        <div className="gc-actions">
          <button type="button" className="gc-button" disabled={busy} onClick={() => void finalize()}>
            Finalizar carteira
          </button>
        </div>
      )}
      {result && (
        <Notice kind="success">
          {result.created} vínculo(s) criado(s), {result.ended} encerrado(s), {result.kept} mantido(s)
          {result.takenOver > 0 && `, ${result.takenOver} tomado(s) de outra carteira`}.
        </Notice>
      )}
    </div>
  );
}
