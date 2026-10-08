import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
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
/** [linha, status, ação ou código do erro, ativação ou mensagem do erro]. */
const brief = (id: number) =>
  lines(id).map((l) =>
    l.errorCode === null
      ? [l.line, l.status, l.action, l.activation]
      : [l.line, l.status, l.errorCode, l.message],
  );
/** O arquivo nunca vai para o banco: nenhuma coluna de conteúdo em `import_jobs`. */
const jobColumns = () =>
  (sq().prepare('select name from pragma_table_info(?)').all('import_jobs') as { name: string }[]).map(
    (c) => c.name,
  );

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
    // O arquivo nunca vai para o banco (LGPD); a auditoria (hash, tamanho, quem, quando) fica.
    expect(jobColumns()).not.toContain('content');
    expect(sq().prepare('select created_by, file_bytes from import_jobs where id = ?').get(sim.id)).toEqual({
      created_by: 'user-1',
      file_bytes: file.length,
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

describe('banco em arquivo (WAL), como em produção', () => {
  it('simula sobre a cópia e grava no banco real', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'csv-wal-'));
    const app = buildApp(
      loadConfig({
        LOG_LEVEL: 'silent',
        NODE_ENV: 'test',
        DATABASE_PATH: join(dir, 'carteira.sqlite'),
        OIDC_ISSUER: 'https://idp.test',
        OIDC_AUDIENCE: 'meugmill',
      }),
    );
    try {
      await app.ready();
      expect(app.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
      seedBranch(app.db, 'SER');
      const s = createImportJobService(app.db, { onJobError: (_id, err) => jobErrors.push(err) });
      const job = s.submit(ADMIN, 'product-subgroups', csv('codigo;nome', 'W1;Um', 'W2;Dois'));
      await s.idle();
      expect(s.get(ADMIN, job.id)).toMatchObject({ status: 'validated', counts: { create: 2 } });
      s.confirm(ADMIN, job.id);
      await s.idle();
      expect(s.get(ADMIN, job.id).status).toBe('applied');
      expect(app.sqlite.prepare('select count(*) n from product_subgroups').get()).toEqual({ n: 2 });
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
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

  it('cancelar descarta o arquivo; confirmar de novo é conflito', async () => {
    const sim = await simulate('product-subgroups', csv('codigo;nome', 'SG1;A'));
    expect(jobs.cancel(ADMIN, sim.id).status).toBe('cancelled');
    expect(codeOf(() => jobs.confirm(ADMIN, sim.id))).toBe('import_not_ready');
    expect(codeOf(() => jobs.cancel(ADMIN, sim.id))).toBe('import_not_ready');
  });

  it('simulação vence no prazo; a subida marca os jobs no meio como interrompidos', async () => {
    const short = svc(200, 1000);
    const sim = await simulate('product-subgroups', csv('codigo;nome', 'SG1;A'), ADMIN, short);
    clock += 1000;
    expect(short.get(ADMIN, sim.id).status).toBe('expired');
    expect(codeOf(() => short.confirm(ADMIN, sim.id))).toBe('import_not_ready');

    // Na subida, o arquivo dos jobs abertos se perdeu com o processo: vencido vira `expired`, o resto
    // `interrupted`.
    const ins = sq().prepare(
      `insert into import_jobs (layout, status, created_by, created_at, updated_at, file_sha256, file_bytes,
        actor_scope, expires_at) values ('branches', ?, 'user-1', 1, 1, 'x', 1, '{}', ?)`,
    );
    ins.run('applying', null);
    ins.run('validated', clock - 1);
    ins.run('validated', clock + 1000);
    ins.run('validating', null);
    expect(jobs.recover()).toBe(4);
    expect(sq().prepare('select status from import_jobs order by id').all()).toEqual([
      { status: 'expired' },
      { status: 'interrupted' },
      { status: 'expired' },
      { status: 'interrupted' },
      { status: 'interrupted' },
    ]);
  });

  it('a varredura vence a simulação sem ninguém ler o job', async () => {
    const short = svc(200, 1000);
    const sim = await simulate('product-subgroups', csv('codigo;nome', 'SG1;A'), ADMIN, short);
    clock += 1000;
    expect(short.sweep()).toBe(1);
    expect(sq().prepare('select status from import_jobs where id = ?').get(sim.id)).toEqual({
      status: 'expired',
    });
    // O envio também varre: a simulação vencida não conta como aberta.
    for (let i = 0; i < 5; i++) {
      await simulate('product-subgroups', csv('codigo;nome', `S${i};A`), ADMIN, short);
    }
    clock += 1000;
    expect(short.submit(ADMIN, 'product-subgroups', csv('codigo;nome', 'X;A')).status).toBe('validating');
    await short.idle();
  });

  it('confirmar com outro escopo de token exige simular de novo', async () => {
    const sim = await simulate('product-subgroups', csv('codigo;nome', 'SG1;A'));
    expect(codeOf(() => jobs.confirm(adminOf('SER', 'CAR'), sim.id))).toBe('import_not_ready');
    expect(codeOf(() => jobs.confirm(actor({ roles: ['admin', 'gestor'], branches: ['SER'] }), sim.id))).toBe(
      'import_not_ready',
    );
    // Mesmo escopo em outra ordem vale.
    expect(jobs.confirm(actor({ roles: ['admin'], branches: ['SER', 'SER'] }), sim.id).status).toBe(
      'applying',
    );
    await jobs.idle();
  });

  it('parar o serviço interrompe o job no próximo bloco', async () => {
    const s1 = svc(1);
    const rows = Array.from({ length: 50 }, (_, i) => `S${i};Nome ${i}`);
    const job = s1.submit(ADMIN, 'product-subgroups', csv('codigo;nome', ...rows));
    s1.stop();
    await s1.idle();
    expect(s1.get(ADMIN, job.id).status).toBe('interrupted');
    expect(codeOf(() => s1.confirm(ADMIN, job.id))).toBe('import_not_ready');
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
  it('cliente de fora do escopo com ativo N: liga e inativa o vínculo com as filiais do usuário', async () => {
    const carId = (sq().prepare("select id from branches where code='CAR'").get() as { id: number }).id;
    const serId = (sq().prepare("select id from branches where code='SER'").get() as { id: number }).id;
    createCustomerService(fx.db).create(adminOf('CAR'), {
      cnpj: CNPJ_D,
      legalName: 'Original',
      municipalityCode: VITORIA,
      neighborhood: 'Centro',
      branchIds: [carId],
    });
    const done = await importAll(
      'customers',
      csv(
        'cnpj;razao_social;municipio_ibge;bairro;filiais;ativo',
        `${CNPJ_D};Original;${VITORIA};Centro;SER;N`,
      ),
    );
    expect(lines(done.id)[0]).toMatchObject({ action: 'linked', activation: 'deactivate' });
    expect(
      sq()
        .prepare(
          'select branch_id b, active a from customer_branches where customer_id = (select id from customers where cnpj = ?) order by branch_id',
        )
        .all(CNPJ_D),
    ).toEqual(
      [
        { b: serId, a: 0 },
        { b: carId, a: 1 },
      ].sort((x, y) => x.b - y.b),
    );
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

  it('a simulação é cumulativa: a carteira que toma o cliente de outra no mesmo arquivo grava igual', async () => {
    await world();
    const lHead = 'filial_codigo;carteira;cnpj;subgrupo_codigo;vendedor_codigo';
    // PB pega o ES inteiro (posto de UF) e fica com A e C; depois PA (município, posto maior) é criada.
    await importAll('portfolios', csv(pHead, 'SER;PB;GEO;gest-01;ES;SG1:V1'));
    await importAll(
      'links',
      csv(lHead, `SER;PB;${CNPJ_A};SG1;V1`, `SER;PB;${CNPJ_B};SG1;V1`, `SER;PB;${CNPJ_C};SG1;V1`),
    );
    await importAll('portfolios', csv(pHead, `SER;PA;GEO;gest-01;ES/${VITORIA};SG1:V2`));
    // Um bloco por carteira: PA toma A e B de PB no 1º bloco; o 2º bloco precisa ver isso.
    const s1 = svc(1);
    const file = csv(lHead, `SER;PA;${CNPJ_A};SG1;V2`, `SER;PA;${CNPJ_B};SG1;V2`, `SER;PB;${CNPJ_C};SG1;V1`);
    const sim = await simulate('links', file, ADMIN, s1);
    expect(sim.status, JSON.stringify(brief(sim.id))).toBe('validated');
    const done = await confirm(sim.id, ADMIN, s1);
    expect(done).toMatchObject({ status: 'applied', errorRows: 0 });
    expect(done.counts).toMatchObject({ create: 2, unchanged: 1, linksTakenOver: 2, portfoliosFinalized: 2 });
    expect(
      sq()
        .prepare(
          `select p.name, count(*) n from portfolio_links l join portfolios p on p.id = l.portfolio_id
           where l.active = 1 group by p.name order by p.name`,
        )
        .all(),
    ).toEqual([
      { name: 'PA', n: 2 },
      { name: 'PB', n: 1 },
    ]);
  });

  it('não revela o que existe fora do escopo: filial do token antes, mesma mensagem para CNPJ inexistente', async () => {
    await world();
    await importAll('portfolios', csv(pHead, `SER;VN;GEO;gest-01;ES/${VITORIA};SG1:V1`));
    const lHead = 'filial_codigo;carteira;cnpj;subgrupo_codigo;vendedor_codigo';
    // D não existe; C existe (Serra) e não é membro: a resposta só depende da posição, não da existência.
    const notMember = [2, 'invalid', 'validation_error', 'Cliente não é membro efetivo da carteira'];
    const unitFailed = [3, 'invalid', 'validation_error', 'Carteira não gravada: outra linha dela tem erro'];
    const dc = await simulate('links', csv(lHead, `SER;VN;${CNPJ_D};SG1;V1`, `SER;VN;${CNPJ_C};SG1;V1`));
    expect(brief(dc.id)).toEqual([notMember, unitFailed]);
    const cd = await simulate('links', csv(lHead, `SER;VN;${CNPJ_C};SG1;V1`, `SER;VN;${CNPJ_D};SG1;V1`));
    expect(brief(cd.id)).toEqual([notMember, unitFailed]);
    // CAR existe mas não está no token; XYZ nem existe: mesma resposta, antes de procurar a carteira.
    const out = await simulate('portfolios', csv(pHead, 'CAR;VN;GEO;g;;', 'XYZ;VN;GEO;g;;'));
    expect(brief(out.id)).toEqual([
      [2, 'invalid', 'forbidden', 'Filial fora do escopo do usuário'],
      [3, 'invalid', 'forbidden', 'Filial fora do escopo do usuário'],
    ]);
  });
});
