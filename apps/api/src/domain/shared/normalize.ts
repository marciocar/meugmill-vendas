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
