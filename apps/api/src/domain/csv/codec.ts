import { DomainError } from '../shared/errors.js';

/** Separador de campo (default pt-BR: abre direto no Excel). */
export const SEPARATOR = ';';
/** Separador de itens dentro de um campo de lista. */
export const LIST_SEPARATOR = '|';
export const BOM = '\uFEFF';
/** Linhas de dados por arquivo (sem contar o cabeçalho). */
export const MAX_DATA_ROWS = 100_000;
/** Tamanho máximo de um campo, em caracteres. */
export const MAX_FIELD_LENGTH = 4000;
/** Colunas por linha. */
const MAX_COLUMNS = 64;

export interface CsvRecord {
  /** Número da linha no arquivo (o cabeçalho é a linha 1), como o Excel mostra. */
  line: number;
  values: string[];
}

export interface CsvDocument {
  header: string[];
  records: CsvRecord[];
}

/** Erro de arquivo: invalida o arquivo inteiro. A mensagem é fixa e nunca ecoa o conteúdo. */
export function fileError(message: string, line?: number): DomainError {
  return new DomainError('validation_error', message, line === undefined ? undefined : { line });
}

// Valores que o Excel interpreta como fórmula (OWASP CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Lê um CSV: UTF-8 (BOM opcional), separador `;`, aspas `"` com `""` de escape (RFC 4180), fim de
 * linha CRLF ou LF. Aspas no meio de um campo sem aspas são texto. Linhas totalmente vazias são ignoradas. Um `'` na frente de um valor que
 * começa como fórmula é retirado (é a proteção que a exportação acrescenta).
 */
export function parseCsv(input: Buffer | string): CsvDocument {
  let text: string;
  if (typeof input === 'string') {
    text = input;
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      throw fileError('Arquivo não está em UTF-8');
    }
  }
  if (text.startsWith(BOM)) text = text.slice(1);

  const rows: CsvRecord[] = [];
  let field = '';
  let fields: string[] = [];
  let quoted = false;
  let wasQuoted = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;

  const pushField = () => {
    if (field.length > MAX_FIELD_LENGTH) throw fileError('Campo maior que o permitido', recordLine);
    fields.push(unprotect(field));
    if (fields.length > MAX_COLUMNS) throw fileError('Colunas demais na linha', recordLine);
    field = '';
    wasQuoted = false;
  };
  const pushRecord = () => {
    pushField();
    if (fields.some((f) => f !== '')) {
      // `rows` inclui o cabeçalho; o limite é de linhas de dados.
      if (rows.length > MAX_DATA_ROWS) throw fileError('Arquivo com linhas demais', recordLine);
      rows.push({ line: recordLine, values: fields });
    }
    fields = [];
  };

  const n = text.length;
  while (i < n) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        const next = text[i];
        if (next !== undefined && next !== SEPARATOR && next !== '\n' && next !== '\r') {
          throw fileError('Aspas mal formadas', recordLine);
        }
        continue;
      }
      if (ch === '\n') line++;
      field += ch;
      i++;
      continue;
    }
    // Aspas só abrem campo no início dele; no meio de um campo sem aspas valem como texto (como no Excel).
    if (ch === '"' && field === '') {
      quoted = true;
      wasQuoted = true;
      i++;
      continue;
    }
    if (ch === SEPARATOR) {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      pushRecord();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      line++;
      recordLine = line;
      continue;
    }
    field += ch;
    i++;
  }
  if (quoted) throw fileError('Aspas sem fechamento', recordLine);
  if (field !== '' || fields.length > 0 || wasQuoted) pushRecord();

  const [head, ...records] = rows;
  if (!head) throw fileError('Arquivo vazio');
  return { header: head.values.map((h) => h.trim()), records };
}

/** Retira o `'` de proteção de um valor que começa como fórmula. */
function unprotect(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

/** Um valor para a saída: protege fórmula e põe aspas quando precisa. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let out = String(value);
  if (FORMULA_START.test(out)) out = `'${out}`;
  return /[";\r\n]/.test(out) || out !== out.trim() ? `"${out.replace(/"/g, '""')}"` : out;
}

/** Uma linha de saída, com CRLF. */
export function csvLine(values: readonly (string | number | null | undefined)[]): string {
  return `${values.map(csvField).join(SEPARATOR)}\r\n`;
}

/** Lista para um campo (`a|b|c`). Vazio vira `[]`; itens vazios são descartados. */
export function splitList(value: string): string[] {
  return value
    .split(LIST_SEPARATOR)
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

export function joinList(values: readonly string[]): string {
  return values.join(LIST_SEPARATOR);
}
