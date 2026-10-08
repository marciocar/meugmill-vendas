import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/domain/csv/codec.js';
import { createExportService } from '../../src/domain/csv/export.js';
import { createImportJobService, type ImportJobService } from '../../src/domain/csv/jobs.js';
import { LAYOUT_IDS, LAYOUTS, headerOf } from '../../src/domain/csv/layouts.js';
import type { Actor } from '../../src/domain/shared/authz.js';
import {
  CNPJ_A,
  CNPJ_B,
  CNPJ_C,
  VITORIA,
  actor,
  adminOf,
  codeOf,
  makeFixture,
  seedBranch,
  seedEconomicGroup,
  seedRetailNetwork,
  type Fixture,
} from '../helpers/seed.js';

let fx: Fixture;
let jobs: ImportJobService;
const ADMIN = adminOf('SER');

const csv = (...lines: string[]) => Buffer.from(`${lines.join('\n')}\n`, 'utf8');
const exportText = (who: Actor, layout: string) =>
  [...createExportService(fx.db).open(who, layout).chunks].join('');

async function importAll(layout: string, content: Buffer | string, who: Actor = ADMIN) {
  const job = jobs.submit(who, layout, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
  await jobs.idle();
  const sim = jobs.get(who, job.id);
  expect(sim.status, JSON.stringify([sim.fileError, jobs.lines(who, job.id).items])).toBe('validated');
  jobs.confirm(who, job.id);
  await jobs.idle();
  return jobs.get(who, job.id);
}

beforeEach(async () => {
  fx = await makeFixture();
  jobs = createImportJobService(fx.db);
  seedBranch(fx.db, 'SER');
  seedRetailNetwork(fx.db, 'R1');
  seedEconomicGroup(fx.db, 'G1');
  fx.app.sqlite
    .prepare(
      `insert into portfolio_types (code, name, name_key, created_at, updated_at, created_by, updated_by)
       values ('GEO','Geográfica','GEOGRAFICA',1,1,'t','t')`,
    )
    .run();
  await importAll('product-subgroups', csv('codigo;nome', 'SG1;Genéricos', 'SG2;=Fórmula'));
  await importAll('sellers', csv('codigo;nome;filiais;ativo', 'V1;Ana;SER;S', 'V2;Bia "B";SER;N'));
  await importAll(
    'customers',
    csv(
      'cnpj;razao_social;nome_fantasia;municipio_ibge;bairro;rede_codigo;grupo_economico_codigo;filiais',
      `${CNPJ_A};Farmácia A; ;${VITORIA};Centro;R1;G1;SER`,
      `${CNPJ_B};"Farmácia; B";Fantasia;${VITORIA};Jardim Camburi;R1;G1;SER`,
      `${CNPJ_C};Farmácia C;;3205002;Centro;;;SER`,
    ),
  );
  await importAll(
    'portfolios',
    csv(
      'filial_codigo;nome;tipo_codigo;responsavel_sub;descricao;regioes;redes;grupos_economicos;vendedores',
      `SER;Vitória;GEO;gest-01;Zona/Leste;ES/${VITORIA}/Jardim Camburi|ES/${VITORIA};R1;G1;SG1:V1`,
    ),
  );
  await importAll(
    'links',
    csv(
      'filial_codigo;carteira;cnpj;subgrupo_codigo;vendedor_codigo',
      `SER;Vitória;${CNPJ_A};SG1;V1`,
      `SER;Vitória;${CNPJ_B};SG1;V1`,
    ),
  );
});
afterEach(async () => {
  await fx.app.close();
});

describe('exportação', () => {
  it('sai com BOM, cabeçalho do layout, CRLF e proteção de fórmula', () => {
    const text = exportText(ADMIN, 'product-subgroups');
    expect(text.startsWith('\uFEFFcodigo;nome;ativo\r\n')).toBe(true);
    expect(text).toContain("SG2;'=Fórmula;S\r\n");
    const customers = parseCsv(exportText(ADMIN, 'customers'));
    expect(customers.header).toEqual(headerOf(LAYOUTS.customers));
    expect(customers.records.map((r) => r.values)).toEqual([
      [CNPJ_A, 'Farmácia A', '', 'ES', String(VITORIA), 'Centro', 'R1', 'G1', 'SER', 'S'],
      [CNPJ_B, 'Farmácia; B', 'Fantasia', 'ES', String(VITORIA), 'Jardim Camburi', 'R1', 'G1', 'SER', 'S'],
      [CNPJ_C, 'Farmácia C', '', 'ES', '3205002', 'Centro', '', '', 'SER', 'S'],
    ]);
    expect(parseCsv(exportText(ADMIN, 'portfolios')).records[0]?.values).toEqual([
      'SER',
      'Vitória',
      'GEO',
      'gest-01',
      'Zona/Leste',
      `ES/${VITORIA}/Jardim Camburi|ES/${VITORIA}`,
      'R1',
      'G1',
      'SG1:V1',
      'ativa',
      'S',
    ]);
    expect(parseCsv(exportText(ADMIN, 'links')).records.map((r) => r.values)).toEqual([
      ['SER', 'Vitória', CNPJ_A, 'SG1', 'V1'],
      ['SER', 'Vitória', CNPJ_B, 'SG1', 'V1'],
    ]);
  });

  it.each(LAYOUT_IDS)('ida e volta de %s: reimportar o exportado não muda nada', async (layout) => {
    const text = exportText(ADMIN, layout);
    const done = await importAll(layout, text);
    const counts = Object.fromEntries(
      Object.entries(done.counts).filter(
        ([k]) => !['linksEnded', 'linksTakenOver', 'portfoliosFinalized'].includes(k),
      ),
    );
    expect(Object.keys(counts)).toEqual(['unchanged']);
    expect(done.counts.linksEnded ?? 0).toBe(0);
  });

  it('respeita escopo e visibilidade (E8): outra filial e vendedor sem vínculos não veem nada', () => {
    const other = adminOf('CAR');
    expect(parseCsv(exportText(other, 'customers')).records).toEqual([]);
    expect(parseCsv(exportText(other, 'links')).records).toEqual([]);
    const seller = actor({ sub: 'vend-x', roles: ['vendedor'], branches: ['SER'] });
    expect(parseCsv(exportText(seller, 'customers')).records).toEqual([]);
    expect(parseCsv(exportText(seller, 'links')).records).toEqual([]);
    // Supervisão lê como o admin.
    const sup = actor({ sub: 'sup', roles: ['supervisao'], branches: ['SER'] });
    expect(parseCsv(exportText(sup, 'links')).records).toHaveLength(2);
  });

  it('recusa layout desconhecido e papel quase conhecido antes do primeiro byte', () => {
    expect(codeOf(() => createExportService(fx.db).open(ADMIN, 'cpfs'))).toBe('validation_error');
    expect(
      codeOf(() =>
        createExportService(fx.db).open(actor({ roles: ['Admin'], branches: ['SER'] }), 'branches'),
      ),
    ).toBe('forbidden');
  });
});
