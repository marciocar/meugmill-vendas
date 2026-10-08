import { monitorEventLoopDelay } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createImportJobService } from '../../src/domain/csv/jobs.js';
import { adminOf, makeFixture, seedBranch, VITORIA, type Fixture } from '../helpers/seed.js';

/**
 * Volume da importação (E10): clientes simulados e gravados, e a reimportação do mesmo arquivo (tudo
 * `unchanged`). Com PERF_ASSERT=1 (`pnpm --filter @meugmill/api test:perf`) roda a meta de dimensionamento
 * (50 mil) e cobra os tetos, inclusive o maior bloqueio da API entre blocos; a suíte normal roda mil e
 * confere só o resultado.
 */
const ASSERT_TIMING = process.env.PERF_ASSERT === '1';
const N = ASSERT_TIMING ? 50_000 : 1_000;

/** CNPJ numérico válido a partir de uma raiz de 8 dígitos (filial 0001). */
function cnpjOf(n: number): string {
  const base = `${String(n).padStart(8, '0')}0001`;
  const dv = (s: string) => {
    let w = s.length - 7;
    let sum = 0;
    for (const ch of s) {
      sum += Number(ch) * w;
      w = w === 2 ? 9 : w - 1;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  return `${base}${d1}${dv(`${base}${d1}`)}`;
}

let fx: Fixture;
beforeAll(async () => {
  fx = await makeFixture();
  seedBranch(fx.db, 'SER');
});
afterAll(async () => {
  await fx.app.close();
});

describe('volume da importação de clientes', () => {
  it(`${N} clientes: simula, grava e reimporta sem mudança`, async () => {
    const admin = adminOf('SER');
    const jobs = createImportJobService(fx.db);
    const lines = ['cnpj;razao_social;municipio_ibge;bairro;filiais'];
    for (let i = 1; i <= N; i++) lines.push(`${cnpjOf(i)};Farmácia ${i};${VITORIA};Bairro ${i % 50};SER`);
    const file = Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');

    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    const run = async (confirm: boolean) => {
      const t0 = performance.now();
      const job = jobs.submit(admin, 'customers', file);
      await jobs.idle();
      const sim = jobs.get(admin, job.id);
      const simMs = performance.now() - t0;
      if (!confirm) return { sim, simMs, applyMs: 0, done: sim };
      const t1 = performance.now();
      jobs.confirm(admin, job.id);
      await jobs.idle();
      return { sim, simMs, applyMs: performance.now() - t1, done: jobs.get(admin, job.id) };
    };

    const first = await run(true);
    expect(first.sim).toMatchObject({ status: 'validated', errorRows: 0, counts: { create: N } });
    expect(first.done).toMatchObject({ status: 'applied', counts: { create: N } });
    const again = await run(false);
    expect(again.sim.counts).toEqual({ unchanged: N });
    loop.disable();
    const maxBlockMs = loop.max / 1e6;
    console.log(
      `[csv-volume] ${N} clientes: simulação ${first.simMs.toFixed(0)} ms; gravação ${first.applyMs.toFixed(0)} ms; ` +
        `reimportação (simulação) ${again.simMs.toFixed(0)} ms; maior bloqueio da API ${maxBlockMs.toFixed(0)} ms`,
    );
    if (ASSERT_TIMING) {
      // Cerca de 1,2 ms por linha em cada fase: a regra passa pelos serviços de domínio, sem atalho.
      expect(first.simMs).toBeLessThan(120_000);
      expect(first.applyMs).toBeLessThan(120_000);
      expect(again.simMs).toBeLessThan(120_000);
      // Entre blocos a API volta a atender: nenhum bloqueio passa de 250 ms.
      expect(maxBlockMs).toBeLessThan(250);
    }
  }, 600_000);
});
