import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/client';
import { describeError } from '../api/errors';
import type { ImportJob, ImportLine, ImportLineStatus, ImportStatus, Page } from '../api/types';
import { Badge, Field, LoadMore, Notice, formatDateTime, usePaged } from '../ui';

export const STATUS_TEXT: Record<ImportStatus, string> = {
  validating: 'Simulando…',
  validated: 'Simulação sem erros: aguardando confirmação',
  invalid: 'Simulação com erros: nada foi gravado',
  applying: 'Gravando…',
  applied: 'Gravada',
  partially_applied: 'Gravada em parte',
  failed: 'Falhou',
  cancelled: 'Cancelada',
  expired: 'Simulação vencida',
  interrupted: 'Interrompida (o serviço reiniciou): envie o arquivo de novo',
};

const RUNNING: ImportStatus[] = ['validating', 'applying'];

const LINE_STATUS: Record<ImportLineStatus, { text: string; tone: 'ok' | 'bad' }> = {
  valid: { text: 'Válida', tone: 'ok' },
  invalid: { text: 'Com erro', tone: 'bad' },
  applied: { text: 'Gravada', tone: 'ok' },
  failed: { text: 'Falhou', tone: 'bad' },
};

const ACTION_TEXT: Record<NonNullable<ImportLine['action']>, string> = {
  create: 'Cria',
  update: 'Altera',
  unchanged: 'Sem mudança',
  linked: 'Liga à filial',
};

const ACTIVATION_TEXT: Record<NonNullable<ImportLine['activation']>, string> = {
  deactivate: 'inativa',
  reactivate: 'reativa',
};

const COUNT_TEXT: Record<string, string> = {
  // Neutros: valem para a simulação (previsto) e para a gravação (feito).
  create: 'criação(ões)',
  update: 'alteração(ões)',
  unchanged: 'sem mudança',
  linked: 'ligação(ões) à filial',
  deactivate: 'inativações',
  reactivate: 'reativações',
  linksEnded: 'vínculos encerrados',
  linksTakenOver: 'vínculos tomados de outra carteira',
  portfoliosFinalized: 'carteiras finalizadas',
};

/** Filtro inicial do relatório: o que precisa de atenção primeiro. */
function defaultLineFilter(status: ImportStatus): string {
  if (status === 'invalid') return 'invalid';
  if (status === 'partially_applied') return 'failed';
  return '';
}

/** Acompanha um job (consulta a cada 1 s enquanto roda), mostra o relatório e confirma ou cancela. */
export function ImportJobPanel({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const api = useApi();
  const [job, setJob] = useState<ImportJob | null>(null);
  // Dois erros separados: o do acompanhamento (some quando a releitura dá certo) e o da última ação
  // (confirmar ou cancelar), que fica até a próxima ação.
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lineFilter, setLineFilter] = useState<string | null>(null);

  // Falhas seguidas da consulta: o acompanhamento continua, com espera crescente (até 15 s).
  const [failures, setFailures] = useState(0);
  const fetchJob = useCallback(async () => {
    try {
      const next = await api.get<ImportJob>(`/v1/imports/${jobId}`);
      setJob(next);
      setError(null);
      setFailures(0);
    } catch (err) {
      setError(`${describeError(err)} Tentando de novo…`);
      setFailures((n) => n + 1);
    }
  }, [api, jobId]);

  useEffect(() => {
    void fetchJob();
  }, [fetchJob]);

  const running = job !== null && RUNNING.includes(job.status);
  // Também tenta de novo quando a primeira leitura falhou (ainda sem job).
  useEffect(() => {
    if (!running && !(job === null && failures > 0)) return;
    const delay = Math.min(1000 * 2 ** Math.max(failures - 1, 0), 15000);
    const t = setTimeout(() => void fetchJob(), delay);
    return () => clearTimeout(t);
  }, [running, job, failures, fetchJob]);

  // O filtro inicial do relatório segue o resultado da fase (erros primeiro).
  useEffect(() => {
    if (job && !running && lineFilter === null) setLineFilter(defaultLineFilter(job.status));
  }, [job, running, lineFilter]);

  const act = async (action: 'confirm' | 'cancel') => {
    if (!job) return;
    setBusy(true);
    setActionError(null);
    try {
      setJob(await api.send<ImportJob>('POST', `/v1/imports/${job.id}/${action}`));
      setLineFilter(null);
    } catch (err) {
      setActionError(describeError(err));
      void fetchJob();
    } finally {
      setBusy(false);
    }
  };

  const filter = lineFilter ?? '';
  const lines = usePaged(
    (cursor) =>
      running || !job
        ? Promise.resolve({ items: [], nextCursor: null })
        : api.get<Page<ImportLine>>(`/v1/imports/${jobId}/lines`, { status: filter, cursor, limit: 200 }),
    [api, jobId, running, job?.status, filter],
  );

  // Redesenha a cada 30 s enquanto aguarda confirmação, para o prazo travar o botão mesmo com a tela parada.
  const [, setNow] = useState(0);
  const waiting = job?.status === 'validated';
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [waiting]);
  // A varredura da API marca `expired` a cada 10 min; a tela já trava o confirmar no prazo.
  const overdue = job?.status === 'validated' && job.expiresAt !== null && job.expiresAt <= Date.now();
  const counts = job ? Object.entries(job.counts).filter(([, n]) => n > 0) : [];

  return (
    <div>
      <button type="button" className="gc-link" onClick={onClose}>
        ← Voltar
      </button>
      <h2>Importação #{jobId}</h2>
      <Notice kind="error">{error}</Notice>
      <Notice kind="error">{actionError}</Notice>
      {!job && !error && <p>Carregando…</p>}
      {job && (
        <>
          <dl className="gc-dl" data-testid="job">
            <dt>Layout</dt>
            <dd>{job.layout}</dd>
            <dt>Situação</dt>
            <dd data-testid="job-status">{STATUS_TEXT[job.status]}</dd>
            <dt>Progresso</dt>
            <dd>
              {job.processedRows} de {job.totalRows} linha(s)
              {job.errorRows > 0 && `, ${job.errorRows} com erro`}
            </dd>
            {counts.length > 0 && (
              <>
                <dt>Resumo</dt>
                <dd>{counts.map(([k, n]) => `${n} ${COUNT_TEXT[k] ?? k}`).join(' · ')}</dd>
              </>
            )}
            <dt>Enviada em</dt>
            <dd>{formatDateTime(job.createdAt)}</dd>
            {job.status === 'validated' && (
              <>
                <dt>Confirmar até</dt>
                <dd>{formatDateTime(job.expiresAt)}</dd>
              </>
            )}
            <dt>SHA-256 do arquivo</dt>
            <dd>
              <code className="gc-hash">{job.fileSha256}</code>
            </dd>
          </dl>
          {job.fileError && (
            <Notice kind="error">
              Arquivo recusado{job.fileError.line ? ` (linha ${job.fileError.line})` : ''}:{' '}
              {job.fileError.message}
            </Notice>
          )}
          {running && (
            <progress
              max={job.totalRows || 1}
              value={job.processedRows}
              aria-label="Progresso da importação"
            />
          )}
          {(job.status === 'validated' || job.status === 'invalid') && (
            <div className="gc-actions">
              {job.status === 'validated' && overdue && (
                <span className="gc-muted">O prazo da simulação venceu: envie o arquivo de novo.</span>
              )}
              {job.status === 'validated' && !overdue && (
                <button
                  type="button"
                  className="gc-button"
                  disabled={busy}
                  onClick={() => void act('confirm')}
                >
                  Confirmar e gravar
                </button>
              )}
              {job.status === 'validated' && (
                <button
                  type="button"
                  className="gc-button gc-button-secondary"
                  disabled={busy}
                  onClick={() => void act('cancel')}
                >
                  Cancelar
                </button>
              )}
              {job.status === 'invalid' && (
                <span className="gc-muted">Corrija as linhas com erro e envie o arquivo de novo.</span>
              )}
            </div>
          )}
          {!running && (
            <section>
              <h3>Relatório por linha</h3>
              <div className="gc-toolbar">
                <Field label="Mostrar">
                  <select value={filter} onChange={(e) => setLineFilter(e.target.value)}>
                    <option value="">Todas</option>
                    <option value="invalid">Com erro na simulação</option>
                    <option value="valid">Válidas</option>
                    <option value="applied">Gravadas</option>
                    <option value="failed">Falharam na gravação</option>
                  </select>
                </Field>
              </div>
              <Notice kind="error">{lines.error}</Notice>
              <table className="gc-table" data-testid="job-lines">
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Situação</th>
                    <th>Ação</th>
                    <th>Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.items.map((l) => (
                    <tr key={l.line}>
                      <td>{l.line}</td>
                      <td>
                        <Badge tone={LINE_STATUS[l.status].tone}>{LINE_STATUS[l.status].text}</Badge>
                      </td>
                      <td>
                        {l.action ? ACTION_TEXT[l.action] : '—'}
                        {l.activation && ` e ${ACTIVATION_TEXT[l.activation]}`}
                      </td>
                      <td>{[l.message, l.warning].filter(Boolean).join(' · ') || '—'}</td>
                    </tr>
                  ))}
                  {!lines.loading && lines.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="gc-muted">
                        Nenhuma linha neste filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <LoadMore paged={lines} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
