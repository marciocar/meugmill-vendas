import { DomainError } from '../shared/errors.js';

/** Separador de campo (default pt-BR: abre direto no Excel). */
export const SEPARATOR = ';';
/** Separador de itens dentro de um campo de lista. */
export const LIST_SEPARATOR = '|';
export const BOM = '﻿';
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

// Valor que o Excel interpreta como fórmula (OWASP CSV injection), inclusive já precedido de `'`: a
// exportação acrescenta sempre mais um `'`, e a importação retira exatamente um, então a volta é exata.
const PROTECTED = /^'*[=+\-@\t\r]/;
// Fim de um campo sem aspas.
const FIELD_END = /[;\r\n]/g;

/**
 * Leitor de CSV incremental: UTF-8 (BOM opcional), separador `;`, aspas `"` com `""` de escape
 * (RFC 4180), fim de linha CRLF, LF ou CR. Aspas no meio de um campo sem aspas são texto. Linhas
 * totalmente vazias são ignoradas. `step(budget)` lê registros inteiros até gastar ~`budget` caracteres,
 * para quem chama ceder a vez entre as fatias; o tamanho do campo é cobrado durante a leitura.
 */
export class CsvReader {
  private readonly text: string;
  private i = 0;
  private line = 1;
  private readonly rows: CsvRecord[] = [];

  constructor(input: Buffer | string) {
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
    this.text = text.startsWith(BOM) ? text.slice(1) : text;
  }

  /** Lê até ~`budget` caracteres (sempre registros inteiros). Devolve `true` quando o texto acabou. */
  step(budget = Number.POSITIVE_INFINITY): boolean {
    const stop = this.i + budget;
    while (this.i < this.text.length && this.i < stop) this.readRecord();
    return this.i >= this.text.length;
  }

  /** O documento lido (chame depois de `step` devolver `true`). */
  result(): CsvDocument {
    const [head, ...records] = this.rows;
    if (!head) throw fileError('Arquivo vazio');
    return { header: head.values.map((h) => h.trim()), records };
  }

  private readRecord(): void {
    const { text } = this;
    const recordLine = this.line;
    const fields: string[] = [];
    for (;;) {
      let value: string;
      if (text[this.i] === '"') {
        value = '';
        let j = this.i + 1;
        for (;;) {
          const q = text.indexOf('"', j);
          if (q < 0) throw fileError('Aspas sem fechamento', recordLine);
          value += text.slice(j, q);
          if (value.length > MAX_FIELD_LENGTH) throw fileError('Campo maior que o permitido', recordLine);
          if (text[q + 1] === '"') {
            value += '"';
            j = q + 2;
            continue;
          }
          j = q + 1;
          break;
        }
        for (let k = value.indexOf('\n'); k >= 0; k = value.indexOf('\n', k + 1)) this.line++;
        this.i = j;
        const next = text[this.i];
        if (next !== undefined && next !== SEPARATOR && next !== '\n' && next !== '\r') {
          throw fileError('Aspas mal formadas', recordLine);
        }
      } else {
        FIELD_END.lastIndex = this.i;
        const end = FIELD_END.exec(text)?.index ?? text.length;
        if (end - this.i > MAX_FIELD_LENGTH) throw fileError('Campo maior que o permitido', recordLine);
        value = text.slice(this.i, end);
        this.i = end;
      }
      fields.push(unprotect(value));
      if (fields.length > MAX_COLUMNS) throw fileError('Colunas demais na linha', recordLine);
      const ch = text[this.i];
      if (ch === SEPARATOR) {
        this.i++;
        continue;
      }
      if (ch === '\r') this.i += text[this.i + 1] === '\n' ? 2 : 1;
      else if (ch === '\n') this.i++;
      if (ch !== undefined) this.line++;
      break;
    }
    if (fields.some((f) => f !== '')) {
      // `rows` inclui o cabeçalho; o limite é de linhas de dados.
      if (this.rows.length > MAX_DATA_ROWS) throw fileError('Arquivo com linhas demais', recordLine);
      this.rows.push({ line: recordLine, values: fields });
    }
  }
}

/** Lê o CSV inteiro de uma vez. */
export function parseCsv(input: Buffer | string): CsvDocument {
  const reader = new CsvReader(input);
  reader.step();
  return reader.result();
}

/** Retira o `'` de proteção que a exportação acrescenta (um só). */
function unprotect(value: string): string {
  return value.startsWith("'") && PROTECTED.test(value.slice(1)) ? value.slice(1) : value;
}

/** Um valor para a saída: protege fórmula e põe aspas quando precisa. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let out = String(value);
  if (PROTECTED.test(out)) out = `'${out}`;
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

/**
 * Lista para a saída. Um item com `|` não tem como voltar igual: a exportação falha em vez de gerar um
 * arquivo que reimporta diferente (o domínio já recusa `|` em códigos e rótulos de bairro).
 */
export function joinList(values: readonly string[]): string {
  if (values.some((v) => v.includes(LIST_SEPARATOR))) {
    throw new DomainError('validation_error', 'Valor com | não pode sair em lista');
  }
  return values.join(LIST_SEPARATOR);
}
