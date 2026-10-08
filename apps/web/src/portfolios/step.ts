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
}
