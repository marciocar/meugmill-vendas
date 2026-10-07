import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('aplica os defaults', () => {
    expect(loadConfig({})).toEqual({
      PORT: 3000,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'info',
      DATABASE_PATH: './data/carteira.sqlite',
      NODE_ENV: 'development',
    });
  });

  it('converte PORT numérica', () => {
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('aceita DATABASE_PATH customizado e :memory:', () => {
    expect(loadConfig({ DATABASE_PATH: ':memory:' }).DATABASE_PATH).toBe(':memory:');
  });

  it('lança erro listando a variável inválida', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ LOG_LEVEL: 'xyz' })).toThrow(/LOG_LEVEL/);
  });
});
