import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportJob } from './api/types';
import { button, click, json, mountWith, page, routeFetch, settle, text } from './test-utils';

const ADMIN = { sub: 'admin-01', roles: ['admin'], branchIds: ['filial-01'] };
const SELLER = { sub: 'vend-01', roles: ['vendedor'], branchIds: ['filial-01'] };

const LAYOUTS = {
  format: 'UTF-8 com BOM, separador ;',
  layouts: [
    {
      id: 'branches',
      title: 'Filiais',
      description: 'Cadastro de filiais',
      key: ['codigo'],
      columns: [
        { name: 'codigo', type: 'texto', required: true, description: 'Código', example: 'filial-01' },
      ],
    },
  ],
};

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 11,
    layout: 'branches',
    status: 'validating',
    createdAt: 1,
    updatedAt: 1,
    fileSha256: 'ab'.repeat(32),
    fileBytes: 20,
    totalRows: 2,
    processedRows: 0,
    errorRows: 0,
    counts: {},
    fileError: null,
    validatedAt: null,
    expiresAt: null,
    confirmedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => {
    document.body.replaceChildren();
  });
});

async function openCsv(el: Awaited<ReturnType<typeof mountWith>>) {
  await click(el, 'Importar e exportar');
}

function chooseFile(el: Awaited<ReturnType<typeof mountWith>>, file: File) {
  const input = el.shadowRoot?.querySelector('[data-testid="csv-file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('telas de CSV', () => {
  it('vendedor exporta, mas não vê a importação', async () => {
    routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, SELLER)],
      ['GET', /\/v1\/csv-layouts$/, () => json(200, LAYOUTS)],
    ]);
    const el = await mountWith();
    await openCsv(el);
    expect(button(el, 'Exportar CSV')).toBeTruthy();
    expect(text(el)).toContain('A importação é só do perfil administrador.');
    expect(el.shadowRoot?.querySelector('[data-testid="csv-file"]')).toBeNull();
  });

  it('admin envia o arquivo, acompanha a simulação e confirma', async () => {
    // A simulação só termina quando o teste manda: prova que a tela consulta de novo sozinha.
    let simulationDone = false;
    const { calls } = routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/csv-layouts$/, () => json(200, LAYOUTS)],
      ['POST', /\/v1\/imports$/, () => json(202, job())],
      [
        'GET',
        /\/v1\/imports\/11$/,
        () =>
          json(
            200,
            !simulationDone
              ? job({ processedRows: 1 })
              : job({
                  status: 'validated',
                  processedRows: 2,
                  counts: { create: 2 },
                  expiresAt: Date.now() + 1000,
                }),
          ),
      ],
      [
        'GET',
        /\/v1\/imports\/11\/lines$/,
        () =>
          json(200, {
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
          }),
      ],
      ['POST', /\/v1\/imports\/11\/confirm$/, () => json(202, job({ status: 'applying' }))],
    ]);
    const el = await mountWith();
    await openCsv(el);
    const file = new File(['codigo;nome;municipio_ibge;ativo\n'], 'filiais.csv', { type: 'text/csv' });
    await chooseFile(el, file);
    await click(el, 'Enviar e simular');

    const post = calls.find((c) => c.method === 'POST' && c.path === '/v1/imports');
    expect(post?.query.get('layout')).toBe('branches');
    expect(post?.headers['Content-Type']).toBe('text/csv');
    expect(post?.body).toBe(file);
    expect(text(el)).toContain('Simulando…');

    simulationDone = true;
    await settle(1100);
    expect(text(el)).toContain('Simulação sem erros: aguardando confirmação');
    expect(text(el)).toContain('2 criação(ões)');
    expect(text(el)).toContain('Cria');

    await click(el, 'Confirmar e gravar');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/imports/11/confirm')).toBe(true);
    expect(text(el)).toContain('Gravando…');
  });

  it('arquivo acima de 16 MB é recusado sem chamar a API', async () => {
    const { calls } = routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/csv-layouts$/, () => json(200, LAYOUTS)],
    ]);
    const el = await mountWith();
    await openCsv(el);
    const big = new File(['x'], 'grande.csv');
    Object.defineProperty(big, 'size', { value: 16 * 1024 * 1024 + 1 });
    await chooseFile(el, big);
    await click(el, 'Enviar e simular');
    expect(text(el)).toContain('Arquivo grande demais');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('simulação com erro mostra as linhas com erro primeiro e não oferece confirmar', async () => {
    routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/csv-layouts$/, () => json(200, LAYOUTS)],
      ['GET', /\/v1\/imports$/, () => json(200, page([job({ status: 'invalid', errorRows: 1 })]))],
      [
        'GET',
        /\/v1\/imports\/11$/,
        () => json(200, job({ status: 'invalid', processedRows: 2, errorRows: 1 })),
      ],
      [
        'GET',
        /\/v1\/imports\/11\/lines$/,
        (call) =>
          json(200, {
            items:
              call.query.get('status') === 'invalid'
                ? [
                    {
                      line: 3,
                      status: 'invalid',
                      action: null,
                      activation: null,
                      errorCode: 'validation_error',
                      message: 'Município inválido',
                      warning: null,
                    },
                  ]
                : [],
            nextCursor: null,
          }),
      ],
    ]);
    const el = await mountWith();
    await openCsv(el);
    await click(el, 'Ver');
    await settle();
    expect(text(el)).toContain('Simulação com erros: nada foi gravado');
    expect(text(el)).toContain('Município inválido');
    expect(() => button(el, 'Confirmar e gravar')).toThrow();
  });

  it('exportar baixa com o Bearer e cria o link temporário', async () => {
    const { calls } = routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, SELLER)],
      ['GET', /\/v1\/csv-layouts$/, () => json(200, LAYOUTS)],
      [
        'GET',
        /\/v1\/exports\/branches$/,
        () =>
          new Response('﻿codigo\r\n', {
            headers: { 'Content-Disposition': 'attachment; filename="branches.csv"' },
          }),
      ],
    ]);
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const el = await mountWith('tok-exp');
    await openCsv(el);
    await click(el, 'Exportar CSV');
    const exp = calls.find((c) => c.path === '/v1/exports/branches');
    expect(exp?.headers.Authorization).toBe('Bearer tok-exp');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});
