import { useEffect } from 'react';
import type { Portfolio } from '../api/types';
import type { Me } from '../use-me';

export type Feedback = { kind: 'error' | 'success' | 'info'; text: string } | null;

/**
 * Executa uma escrita que devolve o agregado. Em sucesso troca a carteira da tela e mostra `success`;
 * em erro mostra a mensagem (e relê a carteira se a versão estava velha). Devolve se deu certo.
 */
export type WriteFn = (op: () => Promise<Portfolio>, success?: string) => Promise<boolean>;

export interface StepProps {
  me: Me;
  portfolio: Portfolio;
  editable: boolean;
  busy: boolean;
  write: WriteFn;
  reload: () => Promise<void>;
  next: () => void;
  /** A etapa avisa se tem edição não salva (o Wizard pergunta antes de sair dela). */
  onDirty: (dirty: boolean) => void;
}

/** Repassa ao Wizard se a etapa tem edição não salva; ao sair da etapa, limpa. */
export function useReportDirty(dirty: boolean, onDirty: (dirty: boolean) => void): void {
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
}
