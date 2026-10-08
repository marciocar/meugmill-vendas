import { useRef, useState, type ReactNode } from 'react';
import { useApi } from '../api/client';
import { describeError } from '../api/errors';
import type { CsvLayout, ImportJob, LayoutId, Page } from '../api/types';
import { isAdmin } from '../roles';
import { Field, LoadMore, Notice, formatDateTime, useAsync, usePaged, useTabShown } from '../ui';
import type { Me } from '../use-me';
import { ImportJobPanel, STATUS_TEXT } from './ImportJobPanel';

/** Os textos do dicionário marcam valores entre crases (`S`, `;`): mostra como código, nunca como HTML. */
export function withCode(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

/** Mesmo teto da API (16 MB): recusa antes de enviar. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;

/** Telas do E10: dicionário de dados, exportação e, para o admin, importação com simulação. */
export function CsvView({ me }: { me: Me }) {
  const api = useApi();
  const catalog = useAsync(() => api.get<{ format: string; layouts: CsvLayout[] }>('/v1/csv-layouts'), [api]);
  const [layoutId, setLayoutId] = useState<LayoutId>('branches');
  const [jobId, setJobId] = useState<number | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const admin = isAdmin(me);
  const layout = catalog.data?.layouts.find((l) => l.id === layoutId) ?? null;

  if (jobId !== null) {
    return (
      <ImportJobPanel
        jobId={jobId}
        onClose={() => {
          setJobId(null);
          setHistoryKey((k) => k + 1);
        }}
      />
    );
  }

  return (
    <div>
      <h2>Importar e exportar</h2>
      <Notice kind="error">{catalog.error}</Notice>
      {catalog.data && <p className="gc-muted">{withCode(catalog.data.format)}</p>}
      <div className="gc-toolbar">
        <Field label="Layout">
          <select value={layoutId} onChange={(e) => setLayoutId(e.target.value as LayoutId)}>
            {(catalog.data?.layouts ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </Field>
        <ExportButton layout={layoutId} />
      </div>
      {layout && <LayoutDictionary layout={layout} />}
      {admin ? (
        <ImportForm layout={layoutId} onSubmitted={setJobId} />
      ) : (
        <Notice kind="info">A importação é só do perfil administrador.</Notice>
      )}
      {admin && <ImportHistory key={historyKey} onOpen={setJobId} />}
    </div>
  );
}

function LayoutDictionary({ layout }: { layout: CsvLayout }) {
  return (
    <details className="gc-details">
      <summary>
        Dicionário de dados — chave: {layout.key.join(' + ')} ({layout.columns.length} colunas)
      </summary>
      <p>{withCode(layout.description)}</p>
      <table className="gc-table">
        <thead>
          <tr>
            <th>Coluna</th>
            <th>Tipo</th>
            <th>Obrigatória</th>
            <th>Descrição</th>
            <th>Exemplo</th>
          </tr>
        </thead>
        <tbody>
          {layout.columns.map((c) => (
            <tr key={c.name}>
              <td>
                <code>{c.name}</code>
              </td>
              <td>{c.type}</td>
              <td>{c.readOnly ? 'só leitura' : c.required ? 'sim' : 'não'}</td>
              <td>{withCode(c.description)}</td>
              <td>
                <code>{c.example}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Baixa o CSV com o Bearer (fetch + blob); o link temporário vive dentro do shadow root. */
function ExportButton({ layout }: { layout: LayoutId }) {
  const api = useApi();
  const holder = useRef<HTMLSpanElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await api.download(`/v1/exports/${layout}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? `${layout}.csv`;
      holder.current?.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span ref={holder}>
      <button
        type="button"
        className="gc-button gc-button-secondary"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? 'Exportando…' : 'Exportar CSV'}
      </button>
      <Notice kind="error">{error}</Notice>
    </span>
  );
}

function ImportForm({ layout, onSubmitted }: { layout: LayoutId; onSubmitted: (jobId: number) => void }) {
  const api = useApi();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!file) return setError('Escolha o arquivo.');
    if (file.size === 0) return setError('O arquivo está vazio.');
    if (file.size > MAX_FILE_BYTES) return setError('Arquivo grande demais (máximo de 16 MB).');
    setBusy(true);
    try {
      const job = await api.upload<ImportJob>('/v1/imports', { layout }, file);
      onSubmitted(job.id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="gc-fieldset">
      <h3>Importar</h3>
      <p className="gc-muted">
        O arquivo é simulado primeiro: nada é gravado até você conferir o relatório e confirmar. A simulação
        vale por 24 horas.
      </p>
      <div className="gc-toolbar">
        <Field label="Arquivo CSV (UTF-8, separador ;)">
          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="csv-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <button type="button" className="gc-button" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Enviando…' : 'Enviar e simular'}
        </button>
      </div>
      <Notice kind="error">{error}</Notice>
    </section>
  );
}

function ImportHistory({ onOpen }: { onOpen: (id: number) => void }) {
  const api = useApi();
  const shown = useTabShown();
  const jobs = usePaged(
    (cursor) => api.get<Page<ImportJob>>('/v1/imports', { cursor, limit: 20 }),
    [api, shown],
  );
  if (!jobs.loading && jobs.items.length === 0 && !jobs.error) return null;
  return (
    <section>
      <h3>Suas importações</h3>
      <Notice kind="error">{jobs.error}</Notice>
      <table className="gc-table" data-testid="import-history">
        <thead>
          <tr>
            <th>#</th>
            <th>Layout</th>
            <th>Enviada em</th>
            <th>Linhas</th>
            <th>Situação</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {jobs.items.map((j) => (
            <tr key={j.id}>
              <td>{j.id}</td>
              <td>{j.layout}</td>
              <td>{formatDateTime(j.createdAt)}</td>
              <td>{j.totalRows}</td>
              <td>{STATUS_TEXT[j.status]}</td>
              <td>
                <button type="button" className="gc-button gc-button-secondary" onClick={() => onOpen(j.id)}>
                  Ver
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <LoadMore paged={jobs} />
    </section>
  );
}
