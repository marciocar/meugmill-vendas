/** Mantém só os dígitos ("11.222.333/0001-81" -> "11222333000181"). */
export function normalizeCnpj(value: string): string {
  return value.replace(/\D/g, '');
}

// Pesos: 5,4,3,2,9,8,7,6,5,4,3,2 para o 1º dígito; 6,5,4,3,2,9,... para o 2º.
function checkDigit(digits: string, length: number): number {
  let weight = length - 7;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += Number(digits[i]) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** 14 dígitos, sem sequência repetida e com os dois dígitos verificadores corretos. */
export function isValidCnpj(value: string): boolean {
  const digits = normalizeCnpj(value);
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  return checkDigit(digits, 12) === Number(digits[12]) && checkDigit(digits, 13) === Number(digits[13]);
}
