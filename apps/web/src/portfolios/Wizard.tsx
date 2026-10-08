import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/client';
import { describeError, isVersionConflict } from '../api/errors';
import type { Portfolio } from '../api/types';
import { canAdminPortfolio, canEditPortfolio } from '../roles';
import { Notice } from '../ui';
import type { Me } from '../use-me';
import { StatusBadges } from './PortfoliosView';
import { StepCustomers } from './StepCustomers';
import { StepFilters } from './StepFilters';
import { StepInfo } from './StepInfo';
import { StepSellers } from './StepSellers';
import { StepSummary } from './StepSummary';
import type { Feedback, WriteFn } from './step';

export const STEPS = ['Informações', 'Filtros', 'Vendedores', 'Resumo', 'Clientes'] as const;

interface WizardProps {
  me: Me;
  /** `null` = carteira nova (só a etapa 1 até criar). */
  portfolioId: number | null;
  onClose: () => void;
}

/**
 * Wizard de 5 etapas. As etapas 1 a 3 gravam ao avançar; a 4 só lê; a 5 trata clientes (prévia e
 * ajustes), distribuição e finalização. Toda escrita manda a versão do agregado (`If-Match`); em
 * `version_conflict` a carteira é relida e o usuário avisado.
 */
export function Wizard({ me, portfolioId, onClose }: WizardProps) {
  const api = useApi();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [step, setStep] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (id: number) => {
      try {
        setPortfolio(await api.get<Portfolio>(`/v1/portfolios/${id}`, { include: 'conflicts' }));
        setLoadError(null);
      } catch (err) {
        setLoadError(describeError(err));
      }
    },
    [api],
  );

  useEffect(() => {
    if (portfolioId !== null) void load(portfolioId);
  }, [portfolioId, load]);

  const write: WriteFn = useCallback(
    async (op, success) => {
      setBusy(true);
      setFeedback(null);
      try {
        const next = await op();
        // A escrita devolve o agregado sem as contagens de conflito: relê para o resumo ficar completo.
        setPortfolio(next);
        void load(next.id);
        if (success) setFeedback({ kind: 'success', text: success });
        return true;
      } catch (err) {
        if (isVersionConflict(err) && portfolio) await load(portfolio.id);
        setFeedback({ kind: 'error', text: describeError(err) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, portfolio],
  );

  if (portfolioId !== null && !portfolio) {
    return (
      <div>
        <button type="button" className="gc-link" onClick={onClose}>
          ← Voltar às carteiras
        </button>
        {loadError ? <Notice kind="error">{loadError}</Notice> : <p>Carregando…</p>}
      </div>
    );
  }

  const editable = portfolio ? canEditPortfolio(me, portfolio) : true;
  const go = (i: number) => {
    setFeedback(null);
    setStep(i);
  };
  const stepProps = portfolio
    ? { me, portfolio, editable, busy, write, reload: () => load(portfolio.id), next: () => go(step + 1) }
    : null;

  return (
    <div className="gc-wizard">
      <button type="button" className="gc-link" onClick={onClose}>
        ← Voltar às carteiras
      </button>
      <div className="gc-title-row">
        <h2>{portfolio ? portfolio.name : 'Nova carteira'}</h2>
        {portfolio && <StatusBadges status={portfolio.status} active={portfolio.active} />}
        {portfolio && canAdminPortfolio(me, portfolio) && (
          <ActivationButton portfolio={portfolio} busy={busy} write={write} />
        )}
      </div>
      {portfolio && !portfolio.active && (
        <Notice kind="info">Carteira inativa: só leitura. Reative-a para editar.</Notice>
      )}
      {portfolio && portfolio.active && !editable && (
        <Notice kind="info">Você pode consultar esta carteira, mas não editá-la.</Notice>
      )}
      <ol className="gc-steps" aria-label="Etapas">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              className={`gc-step${i === step ? ' gc-step-current' : ''}`}
              aria-current={i === step ? 'step' : undefined}
              disabled={!portfolio && i > 0}
              onClick={() => go(i)}
            >
              <span className="gc-step-number">{i + 1}</span> {label}
            </button>
          </li>
        ))}
      </ol>
      {feedback && <Notice kind={feedback.kind}>{feedback.text}</Notice>}
      {step === 0 && (
        <StepInfo
          me={me}
          portfolio={portfolio}
          editable={editable}
          busy={busy}
          write={write}
          onCreated={(p) => {
            setPortfolio(p);
            go(1);
          }}
          next={() => go(1)}
        />
      )}
      {stepProps && step === 1 && <StepFilters key={portfolio!.version} {...stepProps} />}
      {stepProps && step === 2 && <StepSellers key={portfolio!.version} {...stepProps} />}
      {stepProps && step === 3 && <StepSummary {...stepProps} goTo={go} />}
      {stepProps && step === 4 && <StepCustomers {...stepProps} />}
    </div>
  );
}

function ActivationButton({
  portfolio,
  busy,
  write,
}: {
  portfolio: Portfolio;
  busy: boolean;
  write: WriteFn;
}) {
  const api = useApi();
  const action = portfolio.active ? 'deactivate' : 'reactivate';
  return (
    <button
      type="button"
      className="gc-button gc-button-secondary"
      disabled={busy}
      onClick={() =>
        void write(
          () =>
            api.send<Portfolio>('POST', `/v1/portfolios/${portfolio.id}/${action}`, {
              version: portfolio.version,
            }),
          portfolio.active
            ? 'Carteira inativada. Os vínculos dela foram encerrados.'
            : 'Carteira reativada como rascunho. Finalize de novo para gravar os vínculos.',
        )
      }
    >
      {portfolio.active ? 'Inativar' : 'Reativar'}
    </button>
  );
}
