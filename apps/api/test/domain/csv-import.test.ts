import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCustomerService } from '../../src/domain/customers/service.js';
import { createProductSubgroupService } from '../../src/domain/catalog/service.js';
import { createImportJobService, type ImportJobService } from '../../src/domain/csv/jobs.js';
import type { ImportLineResponse } from '../../src/domain/csv/schemas.js';
import type { Actor } from '../../src/domain/shared/authz.js';
import {
  CNPJ_A,
  CNPJ_B,
  CNPJ_C,
  CNPJ_D,
  VITORIA,
  actor,
  adminOf,
  codeOf,
  makeFixture,
  seedBranch,
  seedRetailNetwork,
  type Fixture,
} from '../helpers/seed.js';

let fx: Fixture;
let clock: number;
let jobs: ImportJobService;
let jobErrors: unknown[];
const ADMIN = adminOf('SER');

const sq = () => fx.app.sqlite;
const count = (table: string) => (sq().prepare(`select count(*) n from ${table}`).get() as { n: number }).n;

function svc(chunkRows = 200, ttlMs?: number): ImportJobService {
  return createImportJobService(fx.db, {
    now: () => clock,
    chunkRows,
    ...(ttlMs === undefined ? {} : { ttlMs }),
    onJobError: (_id, err) => jobErrors.push(err),
  });
}

beforeEach(async () => {
  fx = await makeFixture();
  clock = 1_700_000_000_000;
  jobErrors = [];
  jobs = svc();
  seedBranch(fx.db, 'SER');
  seedBranch(fx.db, 'CAR');
  sq()
    .prepare(
      `insert into portfolio_types (code, name, name_key, created_at, updated_at, created_by, updated_by)
       values ('GEO','Geográfica','GEOGRAFICA',1,1,'t','t')`,
    )
    .run();
});
afterEach(async () => {
  await fx.app.close();
  expect(jobErrors).toEqual([]);
});

const csv = (...lines: string[]) => Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');

/** Envia, espera a simulação e devolve o job. */
async function simulate(layout: string, content: Buffer, who: Actor = ADMIN, s: ImportJobService = jobs) {
  const job = s.submit(who, layout, content);
  expect(job.status).toBe('validating');
  await s.idle();
  return s.get(who, job.id);
}

async function confirm(id: number, who: Actor = ADMIN, s: ImportJobService = jobs) {
  expect(s.confirm(who, id).status).toBe('applying');
  await s.idle();
  return s.get(who, id);
}

async function importAll(layout: string, content: Buffer, who: Actor = ADMIN) {
  const sim = await simulate(layout, content, who);
  expect(sim.status, JSON.stringify(jobs.lines(who, sim.id).items)).toBe('validated');
  return confirm(sim.id, who);
}

const lines = (id: number, who: Actor = ADMIN): ImportLineResponse[] => jobs.lines(who, id).items;
const brief = (id: number) =>
  lines(id).map((l) => [l.line, l.status, l.action ?? l.errorCode, l.activation ?? l.message]);

describe('cadastros simples (subgrupos)', () => {
  it('simula sem gravar nada, confirma e grava; reimportar o mesmo arquivo não muda nada', async () => {
    const file = csv('codigo;nome', 'SG1;Genéricos', 'SG2;Éticos');
    const sim = await simulate('product-subgroups', file);
    expect(sim).toMatchObject({
      status: 'validated',
      totalRows: 2,
      processedRows: 2,
      errorRows: 0,
      counts: { create: 2 },
      fileBytes: file.length,
      expiresAt: clock + 24 * 3600 * 1000,
    });
    expect(sim.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(count('product_subgroups')).toBe(0);

    const done = await confirm(sim.id);
    expect(done).toMatchObject({ status: 'applied', counts: { create: 2 }, errorRows: 0 });
    expect(sq().prepare('select code, name, created_by from product_subgroups order by code').all()).toEqual([
      { code: 'SG1', name: 'Genéricos', created_by: 'user-1' },
      { code: 'SG2', name: 'Éticos', created_by: 'user-1' },
    ]);
    // O conteúdo do arquivo é apagado ao terminar (LGPD); a auditoria fica.
    expect(sq().prepare('select content from import_jobs where id = ?').get(sim.id)).toEqual({
      content: null,
    });

    const again = await importAll('product-subgroups', file);
    expect(again.counts).toEqual({ unchanged: 2 });
    expect(
      (sq().prepare("select version from product_subgroups where code = 'SG1'").get() as { version: number })
        .version,
    ).toBe(1);
  });

  it('atualiza o nome e inativa/reativa pela coluna ativo', async () => {
    await importAll('product-subgroups', csv('codigo;nome', 'SG1;A', 'SG2;B'));
    const done = await importAll('product-subgroups', csv('codigo;nome;ativo', 'SG1;A2;S', 'SG2;B;n'));
    expect(done.counts).toEqual({ update: 1, unchanged: 1, deactivate: 1 });
    expect(brief(done.id)).toEqual([
      [2, 'applied', 'update', null],
      [3, 'applied', 'unchanged', 'deactivate'],
    ]);
    const back = await importAll('product-subgroups', csv('codigo;nome', 'SG2;B'));
    expect(back.counts).toEqual({ unchanged: 1, reactivate: 1 });
  });

  it('erros por linha: repetida, mal formada, obrigatória e ativo inválido; não confirma', async () => {
    const sim = await simulate(
      'product-subgroups',
      csv('codigo;nome;ativo', 'SG1;A;', 'SG1;B;', 'SG3', 'SG4;;S', 'SG5;E;X', 'SG6;F;N'),
    );
    expect(sim).toMatchObject({ status: 'invalid', errorRows: 5, counts: { create: 1, deactivate: 1 } });
    expect(brief(sim.id)).toEqual([
      [2, 'invalid', 'duplicate_key', 'Chave repetida no arquivo'],
      [3, 'invalid', 'duplicate_key', 'Chave repetida no arquivo'],
      [4, 'invalid', 'malformed_row', 'Número de campos diferente do cabeçalho'],
      [5, 'invalid', 'validation_error', 'Campo obrigatório: nome'],
      [6, 'invalid', 'validation_error', 'Campo inválido: ativo'],
      [7, 'valid', 'create', 'deactivate'],
    ]);
    expect(jobs.lines(ADMIN, sim.id, { status: 'invalid', limit: 2 }).items.map((l) => l.line)).toEqual([
      2, 3,
    ]);
    expect(codeOf(() => jobs.confirm(ADMIN, sim.id))).toBe('import_not_ready');
    expect(count('product_subgroups')).toBe(0);
    // Simulação com erro não guarda o arquivo.
    expect(sq().prepare('select content from import_jobs where id = ?').get(sim.id)).toEqual({
      content: null,
    });
  });

  it('erro de arquivo (cabeçalho, UTF-8) invalida o job inteiro, com a linha', async () => {
    const bad = await simulate('product-subgroups', csv('codigo;nome;cpf', 'SG1;A;1'));
    expect(bad).toMatchObject({
      status: 'invalid',
      fileError: { message: 'Coluna desconhecida no cabeçalho', line: 1 },
      totalRows: 0,
    });
    const latin1 = await simulate(
      'product-subgroups',
      Buffer.from('codigo;nome\nSG1;Gen\xe9ricos\n', 'latin1'),
    );
    expect(latin1.fileError).toEqual({ message: 'Arquivo não está em UTF-8', line: null });
  });

  it('a linha alterada depois da simulação falha na confirmação, sem sobrescrever', async () => {
    await importAll('product-subgroups', csv('codigo;nome', 'SG1;A', 'SG2;B'));
    const sim = await simulate('product-subgroups', csv('codigo;nome', 'SG1;A2', 'SG2;B2', 'SG3;C'));
    // Alguém edita SG1 e cria SG3 entre a simulação e a confirmação.
    const sg = createProductSubgroupService(fx.db);
    const id = (sq().prepare("select id from product_subgroups where code='SG1'").get() as { id: number }).id;
    sg.update(ADMIN, id, 1, { name: 'Editado' });
    sg.create(ADMIN, { code: 'SG3', name: 'Outro' });
    const done = await confirm(sim.id);
    expect(done).toMatchObject({ status: 'partially_applied', errorRows: 2, counts: { update: 1 } });
    expect(brief(done.id)).toEqual([
      [2, 'failed', 'version_conflict', 'Registro alterado depois da simulação: simule de novo'],
      [3, 'applied', 'update', null],
      [4, 'failed', 'version_conflict', 'Registro alterado depois da simulação: simule de novo'],
    ]);
    expect(
      sq().prepare("select name from product_subgroups where code in ('SG1','SG3') order by code").all(),
    ).toEqual([{ name: 'Editado' }, { name: 'Outro' }]);
  });

  it('processa em blocos (unidades por bloco) com o mesmo resultado', async () => {
    const small = svc(2);
    const rows = Array.from({ length: 7 }, (_, i) => `S${i};Nome ${i}`);
    const sim = await simulate('product-subgroups', csv('codigo;nome', ...rows), ADMIN, small);
    expect(sim).toMatchObject({ status: 'validated', processedRows: 7, counts: { create: 7 } });
    const done = await confirm(sim.id, ADMIN, small);
    expect(done).toMatchObject({ status: 'applied', processedRows: 7 });
    expect(count('product_subgroups')).toBe(7);
  });
});

describe('estado e acesso do job', () => {
  it('só admin importa; o job é só de quem o criou', async () => {
    expect(
      codeOf(() => jobs.submit(actor({ roles: ['supervisao'], branches: ['SER'] }), 'branches', csv('a'))),
    ).toBe('forbidden');
    expect(
      codeOf(() => jobs.submit(actor({ roles: ['Admin'], branches: ['SER'] }), 'branches', csv('a'))),
    ).toBe('forbidden');
    expect(codeOf(() => jobs.submit(ADMIN, 'cpfs', csv('a')))).toBe('validation_error');
    expect(codeOf(() => jobs.submit(ADMIN, 'branches', Buffer.alloc(0)))).toBe('validation_error');
    const sim = await simulate('product-subgroups', csv('codigo;nome', 'SG1;A'));
    const other = actor({ sub: 'user-2', roles: ['admin'], branches: ['SER'] });
    expect(codeOf(() => jobs.get(other, sim.id))).toBe('not_found');
    expect(codeOf(() => jobs.lines(other, sim.id))).toBe('not_found');
    expect(codeOf(() => jobs.confirm(other, sim.id))).toBe('not_found');
    expect(codeOf(() => jobs.cancel(other, sim.id))).toBe('not_found');
    expect(jobs.list(other).items).toEqual([]);
    expect(jobs.list(ADMIN).items.map((j) => j.id)).toEqual([sim.id]);
  });

  it('cancelar apaga o conteúdo; confirmar de novo é conflito', async () => {
    const sim = await simulate('product-subgroups', csv('codigo;nome', 'SG1;A'));
    expect(jobs.cancel(ADMIN, sim.id).status).toBe('cancelled');
    expect(sq().prepare('select content from import_jobs where id = ?').get(sim.id)).toEqual({
      content: null,
    });
    expect(codeOf(() => jobs.confirm(ADMIN, sim.id))).toBe('import_not_ready');
    expect(codeOf(() => jobs.cancel(ADMIN, sim.id))).toBe('import_not_ready');
  });

  it('simulação vence no prazo; a subida marca os jobs no meio como interrompidos', async () => {
    const short = svc(200, 1000);
    const sim = await simulate('product-subgroups', csv('codigo;nome', 'SG1;A'), ADMIN, short);
    clock += 1000;
    expect(short.get(ADMIN, sim.id).status).toBe('expired');
    expect(codeOf(() => short.confirm(ADMIN, sim.id))).toBe('import_not_ready');

    sq()
      .prepare(
        `insert into import_jobs (layout, status, created_by, created_at, updated_at, file_sha256, file_bytes, content)
         values ('branches','applying','user-1',1,1,'x',1,x'00'), ('branches','validated','user-1',1,1,'x',1,x'00')`,
      )
      .run();
    sq()
      .prepare('update import_jobs set expires_at = ? where status = ?')
      .run(clock - 1, 'validated');
    expect(jobs.recover()).toBe(2);
    expect(sq().prepare('select status, content from import_jobs order by id').all()).toEqual([
      { status: 'expired', content: null },
      { status: 'interrupted', content: null },
      { status: 'expired', content: null },
    ]);
  });

  it('limita os jobs abertos por usuário', async () => {
    for (let i = 0; i < 5; i++) await simulate('product-subgroups', csv('codigo;nome', `S${i};A`));
    expect(codeOf(() => jobs.submit(ADMIN, 'product-subgroups', csv('codigo;nome', 'X;A')))).toBe(
      'too_many_imports',
    );
  });
});

describe('filiais, vendedores e clientes', () => {
  it('filial nova exige o código no token; atualiza nome e município', async () => {
    const sim = await simulate(
      'branches',
      csv('codigo;nome;municipio_ibge', 'SER;Serra Sede;3205309', 'NOV;Nova;3205309'),
    );
    expect(brief(sim.id)).toEqual([
      [2, 'valid', 'update', null],
      [3, 'invalid', 'forbidden', 'Filial fora do escopo do usuário'],
    ]);
    const done = await importAll('branches', csv('codigo;nome;municipio_ibge', 'SER;Serra Sede;3205309'));
    expect(done.counts).toEqual({ update: 1 });
    expect(sq().prepare("select name, municipality_code m from branches where code='SER'").get()).toEqual({
      name: 'Serra Sede',
      m: VITORIA,
    });
  });

  it('vendedor: cria, troca filiais dentro do escopo e liga o de fora do escopo', async () => {
    const both = adminOf('SER', 'CAR');
    await importAll('sellers', csv('codigo;nome;filiais', 'V1;Ana;SER', 'V2;Bia;CAR'), both);
    const done = await importAll('sellers', csv('codigo;nome;filiais', 'V1;Ana;SER|CAR'), both);
    expect(done.counts).toEqual({ update: 1 });
    // V2 só está em CAR: para o admin de SER, é cadastro de fora do escopo.
    const linked = await importAll('sellers', csv('codigo;nome;filiais', 'V2;Outro nome;SER'));
    expect(lines(linked.id)[0]).toMatchObject({
      action: 'linked',
      warning:
        'Cadastro existente fora das suas filiais: só o vínculo com as filiais foi feito; os dados não mudaram',
    });
    expect(sq().prepare("select name from sellers where code='V2'").get()).toEqual({ name: 'Bia' });
    expect(
      sq()
        .prepare(
          "select b.code from seller_branches sb join branches b on b.id = sb.branch_id join sellers s on s.id = sb.seller_id where s.code='V2' order by b.code",
        )
        .all(),
    ).toEqual([{ code: 'CAR' }, { code: 'SER' }]);
  });

  it('cliente: cria com rede, atualiza só o que mudou, CNPJ inválido e código inexistente por linha', async () => {
    seedRetailNetwork(fx.db, 'R1');
    const head =
      'cnpj;razao_social;nome_fantasia;municipio_ibge;bairro;rede_codigo;grupo_economico_codigo;filiais';
    const sim = await simulate(
      'customers',
      csv(
        head,
        `11.222.333/0001-81;Farmácia A;;${VITORIA};Centro;R1;;SER`,
        `${CNPJ_B};Farmácia B;Fantasia;${VITORIA};Praia do Canto;;;SER`,
        `11111111111111;Inválido;;${VITORIA};Centro;;;SER`,
        `${CNPJ_C};Farmácia C;;${VITORIA};Centro;R9;;SER`,
      ),
    );
    expect(brief(sim.id)).toEqual([
      [2, 'valid', 'create', null],
      [3, 'valid', 'create', null],
      [4, 'invalid', 'validation_error', 'CNPJ inválido'],
      [5, 'invalid', 'validation_error', 'Código não encontrado: rede_codigo'],
    ]);
    await importAll(
      'customers',
      csv(
        head,
        `11.222.333/0001-81;Farmácia A;;${VITORIA};Centro;R1;;SER`,
        `${CNPJ_B};Farmácia B;Fantasia;${VITORIA};Praia do Canto;;;SER`,
      ),
    );
    const upd = await importAll(
      'customers',
      csv(
        `${head};ativo`,
        `${CNPJ_A};Farmácia  A ;;${VITORIA};Centro;R1;;SER;S`,
        `${CNPJ_B};Farmácia B;;${VITORIA};Praia do Canto;;;SER;N`,
      ),
    );
    // "Farmácia  A " é o mesmo texto depois de limpo; tirar o nome fantasia é mudança.
    expect(upd.counts).toEqual({ unchanged: 1, update: 1, deactivate: 1 });
    expect(sq().prepare('select trade_name from customers where cnpj = ?').get(CNPJ_B)).toEqual({
      trade_name: null,
    });
  });

  it('cliente de fora do escopo só ganha o vínculo; os dados não mudam', async () => {
    createCustomerService(fx.db).create(adminOf('CAR'), {
      cnpj: CNPJ_D,
      legalName: 'Original',
      municipalityCode: VITORIA,
      neighborhood: 'Centro',
      branchIds: [(sq().prepare("select id from branches where code='CAR'").get() as { id: number }).id],
    });
    const done = await importAll(
      'customers',
      csv('cnpj;razao_social;municipio_ibge;bairro;filiais', `${CNPJ_D};Trocado;${VITORIA};Centro;SER`),
    );
    expect(lines(done.id)[0]?.action).toBe('linked');
    expect(sq().prepare('select legal_name from customers where cnpj = ?').get(CNPJ_D)).toEqual({
      legal_name: 'Original',
    });
  });
});

describe('carteiras e vínculos', () => {
  const custHead = 'cnpj;razao_social;municipio_ibge;bairro;filiais';
  const pHead = 'filial_codigo;nome;tipo_codigo;responsavel_sub;regioes;vendedores';

  async function world() {
    await importAll('product-subgroups', csv('codigo;nome', 'SG1;Genéricos', 'SG2;Éticos'));
    await importAll('sellers', csv('codigo;nome;filiais', 'V1;Ana;SER', 'V2;Bia;SER'));
    await importAll(
      'customers',
      csv(
        custHead,
        `${CNPJ_A};A;${VITORIA};Centro;SER`,
        `${CNPJ_B};B;${VITORIA};Jardim Camburi;SER`,
        `${CNPJ_C};C;3205002;Centro;SER`,
      ),
    );
  }

  it('cria a carteira com filtros e vendedores; reimportar é unchanged; troca seção que difere', async () => {
    await world();
    const done = await importAll(
      'portfolios',
      csv(pHead, `SER;Vitória Norte;GEO;gest-01;ES/${VITORIA};SG1:V1|SG2:V2`),
    );
    expect(done.counts).toEqual({ create: 1 });
    const p = sq()
      .prepare("select id, status, responsible_sub r from portfolios where name='Vitória Norte'")
      .get() as {
      id: number;
      status: string;
      r: string;
    };
    expect(p).toMatchObject({ status: 'draft', r: 'gest-01' });
    expect(count('portfolio_regions')).toBe(1);
    expect(count('portfolio_sellers')).toBe(2);

    // O nome bate pela chave normalizada; a mesma composição é unchanged.
    const same = await importAll(
      'portfolios',
      csv(pHead, `SER;vitoria norte;GEO;gest-01;ES/${VITORIA};SG2:V2|SG1:V1`),
    );
    expect(same.counts).toEqual({ update: 1 });
    const same2 = await importAll(
      'portfolios',
      csv(pHead, `SER;vitoria norte;GEO;gest-01;ES/${VITORIA};SG2:V2|SG1:V1`),
    );
    expect(same2.counts).toEqual({ unchanged: 1 });

    const sim = await simulate(
      'portfolios',
      csv(pHead, `SER;X;GEO;g;XX/1;`, `SER;Y;GEO;g;ES/3550308;`, `SER;Z;NAO;g;;`),
    );
    expect(brief(sim.id)).toEqual([
      [2, 'invalid', 'validation_error', 'Campo inválido: regioes'],
      [3, 'invalid', 'validation_error', 'Campo inválido: regioes'],
      [4, 'invalid', 'validation_error', 'Código não encontrado: tipo_codigo'],
    ]);
  });

  it('vínculos: troca as atribuições e finaliza; grade incompleta falha a carteira inteira', async () => {
    await world();
    await importAll('portfolios', csv(pHead, `SER;VN;GEO;gest-01;ES/${VITORIA};SG1:V1|SG1:V2`));
    const lHead = 'filial_codigo;carteira;cnpj;subgrupo_codigo;vendedor_codigo';

    // Falta o cliente B: a grade não fica completa.
    const incomplete = await simulate('links', csv(lHead, `SER;VN;${CNPJ_A};SG1;V1`));
    expect(incomplete.status).toBe('invalid');
    expect(lines(incomplete.id)[0]).toMatchObject({ status: 'invalid', errorCode: 'portfolio_incomplete' });

    // Cliente C (Serra) não é membro; vendedor fora do subgrupo aponta a linha certa.
    const notMember = await simulate(
      'links',
      csv(lHead, `SER;VN;${CNPJ_A};SG1;V1`, `SER;VN;${CNPJ_B};SG1;V2`, `SER;VN;${CNPJ_C};SG1;V1`),
    );
    expect(brief(notMember.id).map((b) => b.slice(0, 3))).toEqual([
      [2, 'invalid', 'validation_error'],
      [3, 'invalid', 'validation_error'],
      [4, 'invalid', 'validation_error'],
    ]);
    expect(lines(notMember.id)[0]?.message).toBe('Carteira não gravada: outra linha dela tem erro');
    expect(lines(notMember.id)[2]?.message).not.toBe('Carteira não gravada: outra linha dela tem erro');
    expect(count('portfolio_assignments')).toBe(0);

    const ok = await importAll('links', csv(lHead, `SER;VN;${CNPJ_A};SG1;V1`, `SER;VN;${CNPJ_B};SG1;V2`));
    expect(ok.counts).toEqual({ create: 2, linksEnded: 0, linksTakenOver: 0, portfoliosFinalized: 1 });
    expect(sq().prepare("select status from portfolios where name='VN'").get()).toEqual({ status: 'active' });
    expect(count('portfolio_links')).toBe(2);

    const same = await importAll('links', csv(lHead, `SER;VN;${CNPJ_B};SG1;V2`, `SER;VN;${CNPJ_A};SG1;V1`));
    expect(same.counts).toEqual({ unchanged: 2, linksEnded: 0, linksTakenOver: 0, portfoliosFinalized: 1 });
    expect(count('portfolio_links')).toBe(2);

    const swap = await importAll('links', csv(lHead, `SER;VN;${CNPJ_A};SG1;V2`, `SER;VN;${CNPJ_B};SG1;V2`));
    expect(swap.counts).toMatchObject({ update: 1, unchanged: 1, linksEnded: 0 });
    expect(
      sq()
        .prepare(
          'select count(*) n from portfolio_links where active = 1 and seller_id = (select id from sellers where code = ?)',
        )
        .get('V2'),
    ).toEqual({ n: 2 });

    const missing = await simulate('links', csv(lHead, `SER;Nenhuma;${CNPJ_A};SG1;V1`));
    expect(lines(missing.id)[0]).toMatchObject({ errorCode: 'not_found' });
  });
});
