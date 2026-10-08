/**
 * CNPJ numérico (14 dígitos) e alfanumérico (IN RFB nº 2.229/2024): 12 primeiras posições em
 * `[0-9A-Z]` e 2 dígitos verificadores numéricos.
 */

/** Remove a máscara (`.`, `/`, `-`, espaços) e põe em maiúsculas ("11.222.333/0001-81" -> "11222333000181"). */
export function normalizeCnpj(value: string): string {
  return value.replace(/[./\s-]/g, '').toUpperCase();
}

const CNPJ_SHAPE = /^[0-9A-Z]{12}[0-9]{2}$/;

// Valor do caractere = código ASCII - 48 (0-9 -> 0-9; 'A' -> 17 ... 'Z' -> 42).
function charValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

// Pesos 2..9 da direita para a esquerda (5,4,3,2,9,8,7,6,5,4,3,2 no 1º dígito; 6,5,...,2 no 2º).
function checkDigit(chars: string, length: number): number {
  let weight = length - 7;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += charValue(chars[i] as string) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** Formato correto, sem sequência de caracteres iguais e com os dois dígitos verificadores corretos. */
export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (!CNPJ_SHAPE.test(cnpj)) return false;
  if (/^(.)\1{13}$/.test(cnpj)) return false;
  return checkDigit(cnpj, 12) === Number(cnpj[12]) && checkDigit(cnpj, 13) === Number(cnpj[13]);
}
