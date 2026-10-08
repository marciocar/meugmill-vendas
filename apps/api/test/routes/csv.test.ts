import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v1Routes } from '../../src/routes/v1/index.js';
import { makeRoutesFixture, type RoutesFixture } from '../helpers/jwt.js';
import { CNPJ_A, VITORIA, seedBranch } from '../helpers/seed.js';

let t: RoutesFixture;
const ADMIN = { sub: 'adm-1', roles: ['admin'], branches: ['SER'] };
const SUPERVISION = { sub: 'sup-1', roles: ['supervisao'], branches: ['SER'] };

beforeEach(async () => {
  t = await makeRoutesFixture(v1Routes);
  seedBranch(t.db, 'SER');
});
afterEach(async () => {
  await t.close();
});

async function upload(layout: string, body: string | Buffer, who = ADMIN, contentType = 'text/csv') {
  return t.app.inject({
    method: 'POST',
    url: `/v1/imports?layout=${layout}`,
    headers: { ...(await t.headers(who)), 'content-type': contentType },
    payload: body,
  });
}

/** Espera o job sair do estado transitório (a fila roda no mesmo processo). */
async function settle(id: number, who = ADMIN) {
  for (let i = 0; i < 200; i++) {
    const res = await t.app.inject({
      method: 'GET',
      url: `/v1/imports/${id}`,
      headers: await t.headers(who),
    });
    const job = res.json();
    if (job.status !== 'validating' && job.status !== 'applying') return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job não terminou');
}

describe('layouts', () => {
  it('lista o dicionário de dados de todos os layouts e de um só', async () => {
    const all = await t.app.inject({
      method: 'GET',
      url: '/v1/csv-layouts',
      headers: await t.headers(SUPERVISION),
    });
    expect(all.statusCode).toBe(200);
    expect(all.json().layouts.map((l: { id: string }) => l.id)).toEqual([
      'branches',
      'product-subgroups',
      'retail-networks',
      'economic-groups',
      'sellers',
      'customers',
      'portfolios',
      'links',
    ]);
    const one = await t.app.inject({
      method: 'GET',
      url: '/v1/csv-layouts/customers',
      headers: await t.headers(),
    });
    expect(one.json()).toMatchObject({ id: 'customers', key: ['cnpj'] });
    expect(one.json().columns[0]).toEqual({
      name: 'cnpj',
      type: 'cnpj',
      required: true,
      description: 'CNPJ com ou sem máscara (numérico ou alfanumérico). Nunca CPF.',
      example: '11.222.333/0001-81',
    });
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/csv-layouts/cpfs', headers: await t.headers() }))
        .statusCode,
    ).toBe(400);
    expect((await t.app.inject({ method: 'GET', url: '/v1/csv-layouts' })).statusCode).toBe(401);
  });
});

describe('importação e exportação por HTTP', () => {
  it('envia (202), simula, mostra o relatório, confirma (202), grava e exporta igual', async () => {
    const file = `\uFEFFcnpj;razao_social;municipio_ibge;bairro;filiais\r\n${CNPJ_A};Farmácia Segredo;${VITORIA};Centro;SER\r\n`;
    const res = await upload('customers', file);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      layout: 'customers',
      status: 'validating',
      fileBytes: Buffer.byteLength(file),
    });
    const sim = await settle(res.json().id);
    expect(sim).toMatchObject({ status: 'validated', counts: { create: 1 }, errorRows: 0 });

    const lines = await t.app.inject({
      method: 'GET',
      url: `/v1/imports/${sim.id}/lines?status=valid`,
      headers: await t.headers(ADMIN),
    });
    expect(lines.json()).toEqual({
      items: [
        {
          line: 2,
          status: 'valid',
          action: 'create',
          activation: null,
          errorCode: null,
          message: null,
          warning: null,
        },
      ],
      nextCursor: null,
    });

    const conf = await t.app.inject({
      method: 'POST',
      url: `/v1/imports/${sim.id}/confirm`,
      headers: await t.headers(ADMIN),
    });
    expect(conf.statusCode).toBe(202);
    expect((await settle(sim.id)).status).toBe('applied');
    const again = await t.app.inject({
      method: 'POST',
      url: `/v1/imports/${sim.id}/confirm`,
      headers: await t.headers(ADMIN),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'import_not_ready' });

    const exp = await t.app.inject({
      method: 'GET',
      url: '/v1/exports/customers',
      headers: await t.headers(ADMIN),
    });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(exp.headers['content-disposition']).toMatch(
      /^attachment; filename="customers-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(exp.body).toBe(
      `\uFEFFcnpj;razao_social;nome_fantasia;uf;municipio_ibge;bairro;rede_codigo;grupo_economico_codigo;filiais;ativo\r\n` +
        `${CNPJ_A};Farmácia Segredo;;ES;${VITORIA};Centro;;;SER;S\r\n`,
    );

    const list = await t.app.inject({ method: 'GET', url: '/v1/imports', headers: await t.headers(ADMIN) });
    expect(list.json().items.map((j: { id: number }) => j.id)).toEqual([sim.id]);
    // O conteúdo do arquivo nunca vai para o log.
    expect(t.logs.join('\n')).not.toContain('Segredo');
    expect(t.logs.join('\n')).not.toContain(CNPJ_A);
  });

  it('recusa: sem token, sem perfil de escrita, layout inválido, corpo que não é CSV, arquivo grande', async () => {
    expect(
      (await t.app.inject({ method: 'POST', url: '/v1/imports?layout=branches', payload: 'a' })).statusCode,
    ).toBe(401);
    expect((await upload('branches', 'codigo;nome;municipio_ibge\n', SUPERVISION)).statusCode).toBe(403);
    expect((await upload('cpfs', 'a\n')).statusCode).toBe(400);
    const json = await upload('branches', JSON.stringify({ a: 1 }), ADMIN, 'application/json');
    expect(json.statusCode).toBe(400);
    expect(json.json()).toEqual({ error: 'validation_error', message: 'Envie o arquivo como text/csv' });
    const big = await upload('branches', Buffer.alloc(16 * 1024 * 1024 + 1, 0x61));
    expect(big.statusCode).toBe(413);
  });

  it('o job é só de quem o criou; cancela; exporta só o que o perfil lê', async () => {
    const res = await upload('product-subgroups', 'codigo;nome\nSG1;A\n');
    const sim = await settle(res.json().id);
    const other = { ...ADMIN, sub: 'adm-2' };
    for (const [method, url] of [
      ['GET', `/v1/imports/${sim.id}`],
      ['GET', `/v1/imports/${sim.id}/lines`],
      ['POST', `/v1/imports/${sim.id}/confirm`],
      ['POST', `/v1/imports/${sim.id}/cancel`],
    ] as const) {
      expect((await t.app.inject({ method, url, headers: await t.headers(other) })).statusCode).toBe(404);
    }
    const cancel = await t.app.inject({
      method: 'POST',
      url: `/v1/imports/${sim.id}/cancel`,
      headers: await t.headers(ADMIN),
    });
    expect(cancel.json().status).toBe('cancelled');

    const seller = { sub: 'vend-1', roles: ['vendedor'], branches: ['SER'] };
    const exp = await t.app.inject({
      method: 'GET',
      url: '/v1/exports/customers',
      headers: await t.headers(seller),
    });
    expect(exp.statusCode).toBe(200);
    expect(exp.body.split('\r\n').filter(Boolean)).toHaveLength(1);
    const bad = await t.app.inject({
      method: 'GET',
      url: '/v1/exports/cpfs',
      headers: await t.headers(ADMIN),
    });
    expect(bad.statusCode).toBe(400);
    const mismatch = await t.app.inject({
      method: 'GET',
      url: '/v1/exports/branches',
      headers: await t.headers({ sub: 'x', roles: ['Admin'], branches: ['SER'] }),
    });
    expect(mismatch.statusCode).toBe(403);
  });
});
