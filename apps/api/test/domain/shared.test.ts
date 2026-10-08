import { describe, expect, it } from 'vitest';
import { isValidCnpj, normalizeCnpj } from '../../src/domain/shared/cnpj.js';
import { DomainError } from '../../src/domain/shared/errors.js';
import { neighborhoodKey, trimCollapse } from '../../src/domain/shared/normalize.js';
import { decodeCursor, encodeCursor, resolveLimit, toPage } from '../../src/domain/shared/pagination.js';
import { parseInput } from '../../src/domain/shared/validate.js';
import { CreateCatalogSchema } from '../../src/domain/catalog/schemas.js';
import { CNPJ_A, CNPJ_B, CNPJ_C, CNPJ_D, codeOf } from '../helpers/seed.js';

describe('cnpj', () => {
  it('normaliza para só dígitos', () => {
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
  });

  it('aceita CNPJs válidos (com e sem máscara)', () => {
    for (const cnpj of [CNPJ_A, CNPJ_B, CNPJ_C, CNPJ_D]) expect(isValidCnpj(cnpj)).toBe(true);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  });

  it('rejeita dígito verificador errado, tamanho errado e vazio', () => {
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('11222333000191')).toBe(false);
    expect(isValidCnpj('1122233300018')).toBe(false);
    expect(isValidCnpj('112223330001811')).toBe(false);
    expect(isValidCnpj('')).toBe(false);
    expect(isValidCnpj('abcdefghijklmn')).toBe(false);
  });

  it('rejeita sequências repetidas', () => {
    for (let d = 0; d <= 9; d++) expect(isValidCnpj(String(d).repeat(14))).toBe(false);
  });
});

describe('normalize', () => {
  it('trimCollapse remove bordas e colapsa espaços', () => {
    expect(trimCollapse('  a \t  b\n c ')).toBe('a b c');
  });

  it('neighborhoodKey: maiúsculas, sem acento, espaços colapsados', () => {
    expect(neighborhoodKey('  Jardim  Câmburi ')).toBe('JARDIM CAMBURI');
    expect(neighborhoodKey('São  Geraldo')).toBe('SAO GERALDO');
    expect(neighborhoodKey('JARDIM CAMBURI')).toBe(neighborhoodKey('jardim camburi'));
  });
});

describe('paginação', () => {
  it('cursor é opaco e faz round-trip', () => {
    const cursor = encodeCursor(123);
    expect(cursor).not.toContain('123');
    expect(decodeCursor(cursor)).toBe(123);
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it('cursor inválido vira validation_error', () => {
    expect(codeOf(() => decodeCursor('###'))).toBe('validation_error');
    expect(codeOf(() => decodeCursor(Buffer.from('abc').toString('base64url')))).toBe('validation_error');
  });

  it('limit: default 50, faixa 1-200', () => {
    expect(resolveLimit(undefined)).toBe(50);
    expect(resolveLimit(1)).toBe(1);
    expect(resolveLimit(200)).toBe(200);
    expect(codeOf(() => resolveLimit(0))).toBe('validation_error');
    expect(codeOf(() => resolveLimit(201))).toBe('validation_error');
  });

  it('toPage corta no limite e aponta o último id entregue', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const page = toPage(rows, 2, (r) => r.id);
    expect(page.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(decodeCursor(page.nextCursor ?? undefined)).toBe(2);
    expect(toPage(rows, 3, (r) => r.id).nextCursor).toBeNull();
  });
});

describe('erros e validação', () => {
  it('a mensagem de validação não ecoa o valor enviado', () => {
    try {
      parseInput(CreateCatalogSchema, { code: 'SEGREDO-123', name: 42 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      const e = err as DomainError;
      expect(e.code).toBe('validation_error');
      expect(e.message).not.toContain('SEGREDO');
      expect(e.message).not.toContain('42');
      expect(e.status).toBe(400);
    }
  });
});
