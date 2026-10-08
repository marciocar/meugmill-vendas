import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/domain/shared/errors.js';
import { parseIfMatch } from '../../src/routes/v1/http.js';

describe('parseIfMatch', () => {
  it('aceita "3", 3 e W/"3"', () => {
    expect(parseIfMatch('"3"')).toBe(3);
    expect(parseIfMatch('3')).toBe(3);
    expect(parseIfMatch('W/"3"')).toBe(3);
  });

  it('ausente -> undefined (o service responde 428)', () => {
    expect(parseIfMatch(undefined)).toBeUndefined();
  });

  it('presente mas malformado -> validation_error (400) sem eco', () => {
    for (const bad of ['', '*', 'abc', '"0"', '-1', '1.5', '"3', ['1', '2']]) {
      try {
        parseIfMatch(bad);
        expect.unreachable(`aceitou ${JSON.stringify(bad)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe('validation_error');
        expect((err as DomainError).message).not.toContain('abc');
      }
    }
  });
});
