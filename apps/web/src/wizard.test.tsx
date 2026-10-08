import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Portfolio } from './api/types';
import { button, click, field, json, mountWith, page, routeFetch, settle, text, type } from './test-utils';

const ADMIN = { sub: 'admin-01', roles: ['admin'], branchIds: ['filial-01'] };
const SELLER = { sub: 'vend-01', roles: ['vendedor'], branchIds: ['filial-01'] };
const BRANCH = { id: 1, code: 'filial-01', name: 'Serra' };
const TYPE = { id: 2, code: 'padrao', name: 'Padrão' };

function portfolio(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    id: 7,
    name: 'Carteira Norte',
    description: null,
    branch: BRANCH,
    type: TYPE,
    responsibleSub: 'admin-01',
    status: 'draft',
    active: true,
    version: 3,
    createdAt: 1,
    updatedAt: 1,
    deactivatedAt: null,
    finalizedAt: null,
    filters: { regions: [], retailNetworks: [], economicGroups: [] },
    sellers: [
      {
        seller: { id: 5, code: 'V1', name: 'Vendedor 1' },
        productSubgroup: { id: 9, code: 'SG', name: 'Genéricos' },
      },
    ],
    overridesInclude: 0,
    overridesExclude: 0,
    conflictsBlocked: 0,
    conflictsLost: 0,
    ...overrides,
  };
}

const summaryRow = {
  id: 7,
  name: 'Carteira Norte',
  branch: BRANCH,
  type: TYPE,
  responsibleSub: 'admin-01',
  status: 'draft',
  active: true,
  version: 3,
  regionsCount: 0,
  retailNetworksCount: 0,
  economicGroupsCount: 0,
  sellersCount: 1,
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => {
    document.body.replaceChildren();
  });
});

describe('wizard da carteira', () => {
  it('admin cria o rascunho na etapa 1 e segue para Filtros', async () => {
    const { calls } = routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      [
        'GET',
        /\/v1\/branches$/,
        () => json(200, page([{ ...BRANCH, active: true, version: 1, municipalityCode: 3205002 }])),
      ],
      ['GET', /\/v1\/portfolio-types$/, () => json(200, page([{ ...TYPE, active: true, version: 1 }]))],
      ['POST', /\/v1\/portfolios$/, () => json(201, portfolio({ version: 1 }))],
      ['GET', /\/v1\/portfolios\/7$/, () => json(200, portfolio({ version: 1 }))],
    ]);
    const el = await mountWith();
    await click(el, 'Nova carteira');
    await type(field(el, 'Nome'), 'Carteira Norte');
    await type(field<HTMLSelectElement>(el, 'Filial'), '1');
    await type(field<HTMLSelectElement>(el, 'Tipo'), '2');
    expect(field(el, 'Responsável').value).toBe('admin-01');
    await click(el, 'Criar rascunho');

    const post = calls.find((c) => c.method === 'POST' && c.path === '/v1/portfolios');
    expect(post?.body).toEqual({
      name: 'Carteira Norte',
      branchId: 1,
      portfolioTypeId: 2,
      responsibleSub: 'admin-01',
    });
    expect(el.shadowRoot?.querySelector('[aria-current="step"]')?.textContent).toContain('Filtros');
  });

  it('version_conflict ao salvar filtros relê a carteira e avisa', async () => {
    // Outra pessoa grava no meio: depois do 409 a carteira relida já está na versão 4.
    let changedElsewhere = false;
    const { calls } = routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/portfolios$/, () => json(200, page([summaryRow]))],
      ['GET', /\/v1\/portfolios\/7$/, () => json(200, portfolio({ version: changedElsewhere ? 4 : 3 }))],
      [
        'GET',
        /\/v1\/retail-networks$/,
        () => json(200, page([{ id: 4, code: 'R1', name: 'Rede Um', active: true, version: 1 }])),
      ],
      [
        'PUT',
        /\/v1\/portfolios\/7\/filters$/,
        () => {
          changedElsewhere = true;
          return json(409, { error: 'version_conflict', message: 'Versão desatualizada' });
        },
      ],
    ]);
    const el = await mountWith();
    await click(el, 'Abrir');
    await click(el, /Filtros/);
    const checkbox = [
      ...(el.shadowRoot?.querySelectorAll('input[type="checkbox"]') ?? []),
    ][0] as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    await click(el, 'Salvar e continuar');

    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers['If-Match']).toBe('"3"');
    expect(put?.body).toEqual({ regions: [], retailNetworkIds: [4], economicGroupIds: [] });
    expect(text(el)).toContain('Outra pessoa alterou esta carteira');
    const putAt = calls.indexOf(put!);
    expect(calls.slice(putAt).some((c) => c.method === 'GET' && c.path === '/v1/portfolios/7')).toBe(true);
  });

  it('vendedor só lê: sem "Nova carteira", campos travados e clientes restritos', async () => {
    routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, SELLER)],
      ['GET', /\/v1\/portfolios$/, () => json(200, page([summaryRow]))],
      ['GET', /\/v1\/portfolios\/7$/, () => json(200, portfolio())],
    ]);
    const el = await mountWith();
    expect(() => button(el, 'Nova carteira')).toThrow();
    await click(el, 'Abrir');
    expect(text(el)).toContain('Você pode consultar esta carteira, mas não editá-la.');
    expect(field(el, 'Nome').disabled).toBe(true);
    expect(() => button(el, 'Inativar')).toThrow();
    await click(el, /Clientes/);
    expect(text(el)).toContain('ficam disponíveis só para o responsável');
  });

  it('finalizar: 409 portfolio_incomplete mostra as contagens; sucesso mostra o resultado', async () => {
    let finalizeAttempts = 0;
    const { calls } = routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/portfolios$/, () => json(200, page([summaryRow]))],
      ['GET', /\/v1\/portfolios\/7$/, () => json(200, portfolio())],
      [
        'GET',
        /\/assignments\/summary$/,
        () =>
          json(200, {
            subgroups: [],
            totals: { members: 2, cells: 2, assigned: 1, unassigned: 1, stale: 0 },
          }),
      ],
      [
        'POST',
        /\/v1\/portfolios\/7\/finalize$/,
        () =>
          finalizeAttempts++ === 0
            ? json(409, { error: 'portfolio_incomplete', detail: { unassigned: 1, stale: 0 } })
            : json(200, {
                portfolio: portfolio({ status: 'active', version: 4 }),
                created: 2,
                ended: 0,
                kept: 0,
                takenOver: 0,
              }),
      ],
    ]);
    const el = await mountWith();
    await click(el, 'Abrir');
    await click(el, /Clientes/);
    await click(el, 'Finalizar');
    expect(text(el)).toContain('Distribua as células pendentes');
    await click(el, 'Finalizar carteira');
    expect(text(el)).toContain('1 célula(s) sem vendedor e 0 com vendedor inválido');
    await click(el, 'Finalizar carteira');
    expect(text(el)).toContain('2 vínculo(s) criado(s)');
    const finalize = calls.filter((c) => c.path.endsWith('/finalize'));
    expect(finalize.every((c) => c.headers['If-Match'] === '"3"')).toBe(true);
  });

  it('prévia: "Excluir" grava o conjunto de ajustes com a versão', async () => {
    const { calls } = routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/portfolios$/, () => json(200, page([summaryRow]))],
      ['GET', /\/v1\/portfolios\/7$/, () => json(200, portfolio())],
      ['GET', /\/overrides$/, () => json(200, { include: [], exclude: [] })],
      [
        'GET',
        /\/preview$/,
        () =>
          json(
            200,
            page([
              {
                customer: {
                  id: 41,
                  cnpj: '90000000000184',
                  legalName: 'Cliente Alfa',
                  municipalityName: 'Serra',
                },
                source: 'filter',
                matchedRegionLevel: 'neighborhood',
                matchedBy: { region: true, retailNetwork: false, economicGroup: false },
                rank: 3,
                resolution: 'assigned',
                competitors: [],
              },
            ]),
          ),
      ],
      ['PUT', /\/overrides$/, () => json(200, portfolio({ version: 4, overridesExclude: 1 }))],
    ]);
    const el = await mountWith();
    await click(el, 'Abrir');
    await click(el, /Clientes/);
    expect(text(el)).toContain('90.000.000/0001-84');
    await click(el, 'Excluir');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({ include: [], exclude: [41] });
    expect(put?.headers['If-Match']).toBe('"3"');
    expect(text(el)).toContain('Cliente excluído da carteira.');
  });

  it('401 numa tela emite token-expired uma vez e mantém a tela montada', async () => {
    routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/portfolios$/, () => json(401, { error: 'unauthorized' })],
    ]);
    const received: Event[] = [];
    const listener = (e: Event) => received.push(e);
    document.addEventListener('token-expired', listener);
    try {
      const el = await mountWith('tok-x');
      await settle(20);
      expect(text(el)).toContain('Sessão expirada');
      expect(received).toHaveLength(1);
      expect(el.shadowRoot?.querySelector('[role="tablist"]')).not.toBeNull();
    } finally {
      document.removeEventListener('token-expired', listener);
    }
  });
});

describe('wizard: modos de falha da revisão adversarial', () => {
  it('etapa 1 depois de um 409 mostra o nome que a outra pessoa gravou (não o reverte)', async () => {
    let renamedElsewhere = false;
    const { calls } = routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/portfolios$/, () => json(200, page([summaryRow]))],
      [
        'GET',
        /\/v1\/branches$/,
        () => json(200, page([{ ...BRANCH, active: true, version: 1, municipalityCode: 1 }])),
      ],
      ['GET', /\/v1\/portfolio-types$/, () => json(200, page([{ ...TYPE, active: true, version: 1 }]))],
      [
        'GET',
        /\/v1\/portfolios\/7$/,
        () => json(200, renamedElsewhere ? portfolio({ name: 'Norte B', version: 4 }) : portfolio()),
      ],
      [
        'PATCH',
        /\/v1\/portfolios\/7$/,
        () => {
          renamedElsewhere = true;
          return json(409, { error: 'version_conflict' });
        },
      ],
    ]);
    const el = await mountWith();
    await click(el, 'Abrir');
    await type(field<HTMLTextAreaElement>(el, 'Descrição'), 'nova descrição');
    await click(el, 'Salvar e continuar');
    expect(text(el)).toContain('Outra pessoa alterou esta carteira');
    expect(field(el, 'Nome').value).toBe('Norte B');
    expect(calls.filter((c) => c.method === 'PATCH')[0]?.body).toEqual({ description: 'nova descrição' });
  });

  it('ajustes: enquanto a lista relê depois de uma gravação, os botões de escrita ficam desabilitados', async () => {
    let releaseOverrides: (() => void) | null = null;
    let writes = 0;
    routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/portfolios$/, () => json(200, page([summaryRow]))],
      ['GET', /\/v1\/portfolios\/7$/, () => json(200, portfolio({ version: 3 + writes }))],
      [
        'GET',
        /\/overrides$/,
        () =>
          writes === 0
            ? json(200, { include: [], exclude: [] })
            : new Promise<Response>((r) => {
                releaseOverrides = () => r(json(200, { include: [], exclude: [] }));
              }),
      ],
      [
        'GET',
        /\/preview$/,
        () =>
          json(
            200,
            page([
              {
                customer: { id: 41, cnpj: '90000000000184', legalName: 'Cliente Alfa' },
                source: 'filter',
                matchedRegionLevel: 'state',
                matchedBy: { region: true, retailNetwork: false, economicGroup: false },
                rank: 1,
                resolution: 'assigned',
                competitors: [],
              },
            ]),
          ),
      ],
      [
        'PUT',
        /\/overrides$/,
        () => {
          writes += 1;
          return json(200, portfolio({ version: 3 + writes }));
        },
      ],
    ]);
    const el = await mountWith();
    await click(el, 'Abrir');
    await click(el, /Clientes/);
    await click(el, 'Excluir');
    expect(button(el, 'Excluir').disabled).toBe(true);
    await act(async () => releaseOverrides?.());
    await settle();
    expect(button(el, 'Excluir').disabled).toBe(false);
  });

  it('inativar pede confirmação antes de gravar', async () => {
    const { calls } = routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/portfolios$/, () => json(200, page([summaryRow]))],
      ['GET', /\/v1\/portfolios\/7$/, () => json(200, portfolio({ status: 'active' }))],
      ['POST', /\/deactivate$/, () => json(200, portfolio({ active: false, version: 4 }))],
    ]);
    const el = await mountWith();
    await click(el, 'Abrir');
    await click(el, 'Inativar');
    expect(calls.some((c) => c.path.endsWith('/deactivate'))).toBe(false);
    expect(text(el)).toContain('encerra todos os vínculos');
    await click(el, 'Sim, inativar');
    const post = calls.find((c) => c.path.endsWith('/deactivate'));
    expect(post?.headers['If-Match']).toBe('"3"');
  });

  it('trocar de etapa com edição não salva pede confirmação', async () => {
    routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/portfolios$/, () => json(200, page([summaryRow]))],
      ['GET', /\/v1\/portfolios\/7$/, () => json(200, portfolio())],
      [
        'GET',
        /\/v1\/retail-networks$/,
        () => json(200, page([{ id: 4, code: 'R1', name: 'Rede Um', active: true, version: 1 }])),
      ],
    ]);
    const el = await mountWith();
    await click(el, 'Abrir');
    await click(el, /Filtros/);
    const checkbox = el.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    await settle();
    await click(el, /Vendedores/);
    expect(text(el)).toContain('Há alterações não salvas nesta etapa.');
    expect(el.shadowRoot?.querySelector('[aria-current="step"]')?.textContent).toContain('Filtros');
    await click(el, 'Descartar e sair da etapa');
    expect(el.shadowRoot?.querySelector('[aria-current="step"]')?.textContent).toContain('Vendedores');
  });

  it('troca de token para outro usuário cujo /v1/me falha tira o usuário anterior da tela', async () => {
    routeFetch([
      [
        'GET',
        /\/v1\/me$/,
        (call) =>
          call.headers.Authorization === 'Bearer tok-A'
            ? json(200, ADMIN)
            : json(503, { error: 'auth_unavailable' }),
      ],
      ['GET', /\/v1\/portfolios$/, () => json(200, page([summaryRow]))],
    ]);
    const el = await mountWith('tok-A');
    expect(text(el)).toContain('admin-01');
    await act(async () => {
      el.token = 'tok-B';
    });
    await settle();
    expect(text(el)).not.toContain('admin-01');
    expect(text(el)).not.toContain('Carteira Norte');
    expect(text(el)).toContain('Serviço indisponível');
  });

  it('trocar de aba e voltar mantém o wizard e a edição não salva', async () => {
    routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/portfolios$/, () => json(200, page([summaryRow]))],
      ['GET', /\/v1\/portfolios\/7$/, () => json(200, portfolio())],
      [
        'GET',
        /\/v1\/me\/visibility$/,
        () => json(200, { profiles: ['admin'], mode: 'profiles', seller: null, visibleCustomers: 0 }),
      ],
    ]);
    const el = await mountWith();
    await click(el, 'Abrir');
    await type(field(el, 'Nome'), 'Nome em edição');
    await click(el, 'Meus clientes');
    await click(el, 'Carteiras');
    expect(field(el, 'Nome').value).toBe('Nome em edição');
  });

  it('voltar à aba Carteiras relê a lista', async () => {
    const { calls } = routeFetch([
      ['GET', /\/v1\/me$/, () => json(200, ADMIN)],
      ['GET', /\/v1\/portfolios$/, () => json(200, page([summaryRow]))],
    ]);
    const el = await mountWith();
    const before = calls.filter((c) => c.path === '/v1/portfolios').length;
    await click(el, 'Importar e exportar');
    await click(el, 'Carteiras');
    expect(calls.filter((c) => c.path === '/v1/portfolios').length).toBeGreaterThan(before);
  });
});
