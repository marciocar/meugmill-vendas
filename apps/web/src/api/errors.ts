import { ApiError } from './client';

const MESSAGES: Record<string, string> = {
  network_error: 'Não foi possível falar com o serviço. Verifique a conexão e tente de novo.',
  unauthorized: 'Sessão expirada.',
  forbidden: 'Seu perfil não permite esta operação.',
  not_found: 'Registro não encontrado ou fora do seu acesso.',
  validation_error: 'Dados inválidos.',
  conflict: 'Já existe um registro com esse nome ou código.',
  customer_exists: 'Já existe um cliente com esse CNPJ.',
  seller_exists: 'Já existe um vendedor com esse código.',
  version_conflict: 'Outra pessoa alterou esta carteira. A versão atual foi carregada: revise e repita.',
  precondition_required: 'A versão da carteira não foi enviada. Recarregue e repita.',
  portfolio_inactive: 'A carteira está inativa. Reative-a para editar.',
  portfolio_incomplete: 'Há clientes sem vendedor em algum subgrupo.',
  portfolio_has_conflicts: 'Há clientes bloqueados por empate com outra carteira.',
  link_conflict: 'Outra carteira ocupa vínculos desta. Fale com o suporte.',
  import_not_ready: 'A importação não está pronta para esta ação.',
  too_many_imports: 'Há importações demais abertas. Conclua ou cancele alguma antes de enviar outra.',
  auth_unavailable: 'O serviço de login está indisponível. Tente de novo em instantes.',
  internal_error: 'Erro inesperado no serviço.',
  bad_response: 'Resposta inesperada do serviço.',
};

/** Códigos em que o texto da tela diz melhor o que fazer do que a mensagem da API. */
const PREFER_OWN = new Set([
  'version_conflict',
  'precondition_required',
  'portfolio_inactive',
  'too_many_imports',
]);

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Texto em pt-BR para mostrar ao usuário. Usa a mensagem fixa do domínio quando ela existe. */
export function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Erro inesperado.';
  if (err.status === 413) return 'Arquivo grande demais (máximo de 16 MB).';
  if (err.code === 'portfolio_incomplete' && err.detail) {
    const unassigned = num(err.detail.unassigned) ?? 0;
    const stale = num(err.detail.stale) ?? 0;
    return `Não dá para finalizar: ${unassigned} célula(s) sem vendedor e ${stale} com vendedor inválido.`;
  }
  if (err.code === 'portfolio_has_conflicts' && err.detail) {
    return `Não dá para finalizar: ${num(err.detail.blocked) ?? 0} cliente(s) bloqueado(s) por empate com outra carteira.`;
  }
  if (PREFER_OWN.has(err.code)) return MESSAGES[err.code]!;
  // As mensagens de domínio são textos fixos, sem eco do valor enviado: podem ser mostradas.
  if (err.apiMessage && err.status >= 400 && err.status < 500) return err.apiMessage;
  return MESSAGES[err.code] ?? (err.status >= 500 ? MESSAGES.internal_error! : 'Não foi possível concluir.');
}

export const isVersionConflict = (err: unknown): boolean =>
  err instanceof ApiError && err.code === 'version_conflict';
