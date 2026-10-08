import { useState, type FormEvent } from 'react';
import { listAll, useApi } from '../api/client';
import { describeError } from '../api/errors';
import type { Branch, Catalog, Portfolio } from '../api/types';
import { canAdminPortfolio } from '../roles';
import { Field, Notice, useAsync } from '../ui';
import type { Me } from '../use-me';
import { useReportDirty, type WriteFn } from './step';

interface StepInfoProps {
  me: Me;
  portfolio: Portfolio | null;
  editable: boolean;
  busy: boolean;
  write: WriteFn;
  onCreated: (p: Portfolio) => void;
  next: () => void;
  onDirty: (dirty: boolean) => void;
}

/** Etapa 1: nome, descrição, filial, tipo e responsável. Cria o rascunho ou altera só o que mudou. */
export function StepInfo({ me, portfolio, editable, busy, write, onCreated, next, onDirty }: StepInfoProps) {
  const api = useApi();
  const [name, setName] = useState(portfolio?.name ?? '');
  const [description, setDescription] = useState(portfolio?.description ?? '');
  const [branchId, setBranchId] = useState(portfolio ? String(portfolio.branch.id) : '');
  const [typeId, setTypeId] = useState(portfolio ? String(portfolio.type.id) : '');
  const [responsibleSub, setResponsibleSub] = useState(portfolio?.responsibleSub ?? me.sub);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Trocar a filial encerra os vínculos: o 1º clique só pede confirmação.
  const [confirmBranch, setConfirmBranch] = useState(false);

  const options = useAsync(async () => {
    const [branches, types] = await Promise.all([
      listAll<Branch>(api, '/v1/branches', { active: true }),
      listAll<Catalog>(api, '/v1/portfolio-types', { active: true }),
    ]);
    // Só as filiais do token servem para criar ou transferir.
    return { branches: branches.filter((b) => me.branchIds.includes(b.code)), types };
  }, [api, me]);

  // Responsável que não é admin edita o resto, mas não troca filial nem responsável.
  const canChangeOwner = portfolio ? canAdminPortfolio(me, portfolio) : true;
  const readOnly = !editable;

  const patch: Record<string, unknown> = {};
  if (portfolio) {
    if (name.trim() !== portfolio.name) patch.name = name.trim();
    if (description.trim() !== (portfolio.description ?? '')) patch.description = description.trim();
    if (Number(typeId) !== portfolio.type.id) patch.portfolioTypeId = Number(typeId);
    if (canChangeOwner && Number(branchId) !== portfolio.branch.id) patch.branchId = Number(branchId);
    if (canChangeOwner && responsibleSub.trim() !== portfolio.responsibleSub) {
      patch.responsibleSub = responsibleSub.trim();
    }
  }
  const dirty =
    !readOnly &&
    (portfolio ? Object.keys(patch).length > 0 : name.trim() !== '' || description.trim() !== '');
  useReportDirty(dirty, onDirty);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (readOnly) return next();
    if (!name.trim() || !branchId || !typeId || !responsibleSub.trim()) {
      setError('Preencha nome, filial, tipo e responsável.');
      return;
    }
    if (!portfolio) {
      setCreating(true);
      try {
        const created = await api.send<Portfolio>('POST', '/v1/portfolios', {
          body: {
            name: name.trim(),
            description: description.trim() || undefined,
            branchId: Number(branchId),
            portfolioTypeId: Number(typeId),
            responsibleSub: responsibleSub.trim(),
          },
        });
        onCreated(created);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setCreating(false);
      }
      return;
    }
    if (Object.keys(patch).length === 0) return next();
    if (patch.branchId !== undefined && !confirmBranch) {
      setConfirmBranch(true);
      return;
    }
    const ok = await write(
      () =>
        api.send<Portfolio>('PATCH', `/v1/portfolios/${portfolio.id}`, {
          body: patch,
          version: portfolio.version,
        }),
      'Informações salvas.',
    );
    if (ok) next();
  };

  const branches = options.data?.branches ?? [];
  const types = options.data?.types ?? [];
  // A carteira pode estar numa filial ou tipo já inativos: mostra o valor atual mesmo assim.
  const branchOptions =
    portfolio && !branches.some((b) => b.id === portfolio.branch.id)
      ? [portfolio.branch, ...branches]
      : branches;
  const typeOptions =
    portfolio && !types.some((t) => t.id === portfolio.type.id) ? [portfolio.type, ...types] : types;

  return (
    <form className="gc-form" onSubmit={submit}>
      <Notice kind="error">{options.error}</Notice>
      <Field label="Nome">
        <input
          value={name}
          maxLength={120}
          disabled={readOnly}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Descrição">
        <textarea
          value={description}
          maxLength={1000}
          rows={2}
          disabled={readOnly}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field
        label="Filial"
        hint={portfolio && canChangeOwner ? 'Trocar a filial encerra os vínculos da carteira.' : undefined}
      >
        <select
          value={branchId}
          disabled={readOnly || !canChangeOwner}
          onChange={(e) => {
            setBranchId(e.target.value);
            setConfirmBranch(false);
          }}
        >
          <option value="">Selecione</option>
          {branchOptions.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} — {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tipo">
        <select value={typeId} disabled={readOnly} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Selecione</option>
          {typeOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Responsável" hint="Identificador do login do responsável (sub).">
        <input
          value={responsibleSub}
          maxLength={255}
          disabled={readOnly || !canChangeOwner}
          onChange={(e) => setResponsibleSub(e.target.value)}
        />
      </Field>
      <Notice kind="error">{error}</Notice>
      {confirmBranch && (
        <Notice kind="info">
          Trocar a filial encerra todos os vínculos desta carteira e a volta para rascunho. Clique de novo
          para confirmar.
        </Notice>
      )}
      <div className="gc-actions">
        <button type="submit" className="gc-button" disabled={busy || creating}>
          {readOnly
            ? 'Próxima etapa'
            : !portfolio
              ? 'Criar rascunho'
              : confirmBranch
                ? 'Confirmar troca de filial'
                : 'Salvar e continuar'}
        </button>
      </div>
    </form>
  );
}
