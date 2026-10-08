/** Remove bordas e colapsa qualquer sequência de espaços em um só. */
export function trimCollapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Chave de comparação do bairro (E4): maiúsculas, sem acento (NFD), espaços colapsados.
 * "  Jardim  Câmburi " -> "JARDIM CAMBURI".
 */
export function neighborhoodKey(value: string): string {
  return trimCollapse(value).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
}

/**
 * Chave de busca acento e caixa-insensível (`legal_name_key`, `name_key`...). Mesma normalização
 * do bairro; a migration 0003 faz o backfill equivalente em SQL para o português.
 */
export const searchKey = neighborhoodKey;
