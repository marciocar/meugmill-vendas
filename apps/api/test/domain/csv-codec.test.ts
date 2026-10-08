import { describe, expect, it } from 'vitest';
import {
  BOM,
  MAX_DATA_ROWS,
  csvField,
  csvLine,
  joinList,
  parseCsv,
  splitList,
} from '../../src/domain/csv/codec.js';
import { DomainError } from '../../src/domain/shared/errors.js';
import { LAYOUTS, bindRows, headerOf } from '../../src/domain/csv/layouts.js';

function fileErr(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    return err as DomainError;
  }
  throw new Error('esperava erro');
}

describe('parseCsv', () => {
  it('lê ; com BOM, CRLF, aspas, aspas escapadas e quebra de linha dentro de aspas', () => {
    const doc = parseCsv(Buffer.from(`${BOM}a;b;c\r\n1;"x;y";"di""z"\r\n2;"linha\r\nnova";\r\n`, 'utf8'));
    expect(doc.header).toEqual(['a', 'b', 'c']);
    expect(doc.records).toEqual([
      { line: 2, values: ['1', 'x;y', 'di"z'] },
      { line: 3, values: ['2', 'linha\r\nnova', ''] },
    ]);
  });

  it('aceita LF, sem BOM e sem quebra no fim; ignora linhas vazias', () => {
    const doc = parseCsv('a;b\n\n1;2\n;\n3;4');
    expect(doc.records.map((r) => [r.line, r.values])).toEqual([
      [3, ['1', '2']],
      [5, ['3', '4']],
    ]);
  });

  it('recusa UTF-8 inválido, arquivo vazio e aspas mal formadas, sem ecoar conteúdo', () => {
    expect(fileErr(() => parseCsv(Buffer.from([0x61, 0x3b, 0xe9, 0x0a]))).message).toBe(
      'Arquivo não está em UTF-8',
    );
    expect(fileErr(() => parseCsv(`${BOM}\r\n`)).message).toBe('Arquivo vazio');
    const e = fileErr(() => parseCsv('a;b\n1;"sem fim\n'));
    expect(e.message).toBe('Aspas sem fechamento');
    expect(e.detail).toEqual({ line: 2 });
    expect(parseCsv('a;b\n1;Bia "B"\n').records[0]?.values).toEqual(['1', 'Bia "B"']);
    expect(fileErr(() => parseCsv('a;b\n1;"x"y\n')).detail).toEqual({ line: 2 });
  });

  it('limita linhas de dados e tamanho de campo', () => {
    const ok = `a\n${'1\n'.repeat(MAX_DATA_ROWS)}`;
    expect(parseCsv(ok).records).toHaveLength(MAX_DATA_ROWS);
    expect(fileErr(() => parseCsv(`${ok}1\n`)).message).toBe('Arquivo com linhas demais');
    expect(fileErr(() => parseCsv(`a\n${'x'.repeat(4001)}\n`)).message).toBe('Campo maior que o permitido');
  });

  it('retira o apóstrofo de proteção de fórmula, com ou sem aspas', () => {
    const doc = parseCsv(`a;b;c\n'=1+1;"'-x;y";'normal\n`);
    expect(doc.records[0]?.values).toEqual(['=1+1', '-x;y', "'normal"]);
  });
});

describe('escrita', () => {
  it('protege fórmula, põe aspas quando precisa e volta igual pela leitura', () => {
    const values = ['=SOMA(A1)', '+55', '-1', '@x', 'a;b', 'di"z', ' borda ', 'linha\nnova', '', 'ok'];
    expect(csvField('=SOMA(A1)')).toBe("'=SOMA(A1)");
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField(null)).toBe('');
    expect(csvField(3205002)).toBe('3205002');
    const line = csvLine(values);
    expect(line.endsWith('\r\n')).toBe(true);
    const doc = parseCsv(`${csvLine(values.map((_, i) => `c${i}`))}${line}`);
    expect(doc.records[0]?.values).toEqual(values);
  });

  it('lista com |', () => {
    expect(splitList(' F01 | |F02|')).toEqual(['F01', 'F02']);
    expect(splitList('')).toEqual([]);
    expect(joinList(['F01', 'F02'])).toBe('F01|F02');
  });
});

describe('bindRows', () => {
  const layout = LAYOUTS['product-subgroups'];

  it('aceita colunas em qualquer ordem e opcionais ausentes', () => {
    const rows = bindRows(layout, parseCsv('nome;codigo\n Genéricos ;SG01\n'));
    expect(rows[0]?.get('codigo')).toBe('SG01');
    expect(rows[0]?.get('nome')).toBe('Genéricos');
    expect(rows[0]?.get('ativo')).toBe('');
    expect(rows[0]?.has('ativo')).toBe(false);
    expect(rows[0]?.malformed).toBe(false);
  });

  it('recusa coluna desconhecida, repetida ou obrigatória ausente', () => {
    expect(fileErr(() => bindRows(layout, parseCsv('codigo;nome;cpf\n'))).message).toBe(
      'Coluna desconhecida no cabeçalho',
    );
    expect(fileErr(() => bindRows(layout, parseCsv('codigo;nome;nome\n'))).message).toBe(
      'Coluna repetida no cabeçalho',
    );
    expect(fileErr(() => bindRows(layout, parseCsv('codigo\n'))).message).toBe(
      'Coluna obrigatória ausente no cabeçalho',
    );
  });

  it('marca a linha com número de campos diferente, sem invalidar o arquivo', () => {
    const rows = bindRows(layout, parseCsv('codigo;nome\nSG01\nSG02;B\n'));
    expect(rows.map((r) => r.malformed)).toEqual([true, false]);
    expect(rows[0]?.get('codigo')).toBe('');
  });

  it('cabeçalho de exportação segue a ordem do layout, com as colunas só de leitura', () => {
    expect(headerOf(LAYOUTS.customers)).toContain('uf');
    expect(headerOf(LAYOUTS.portfolios)).toContain('situacao');
    // Minimização: nenhum layout tem coluna de CPF, e-mail, telefone ou login do vendedor.
    for (const l of Object.values(LAYOUTS)) {
      for (const c of headerOf(l)) expect(c).not.toMatch(/cpf|email|telefone|user_sub/);
    }
  });
});
