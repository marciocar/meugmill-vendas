// Gera o snapshot IBGE e a migration de seed. Roda à mão (não no boot):
//
//   pnpm --filter @meugmill/api exec tsx scripts/build-ibge-seed.ts <estados.json> <municipios.json>
//
// Entradas: respostas cruas de
//   https://servicodados.ibge.gov.br/api/v1/localidades/estados
//   https://servicodados.ibge.gov.br/api/v1/localidades/municipios
// Saídas:
//   drizzle/data/ibge-localidades-<data>.json  (snapshot enxuto)
//   drizzle/0002_seed_ibge.sql                 (criar o arquivo antes com
//                                               `drizzle-kit generate --custom --name seed_ibge`)
// Os JSONs de entrada são tratados como dado não confiável: tudo é validado antes de gerar SQL.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SNAPSHOT_DATE = '2026-10-08';
const BATCH_SIZE = 500;
const SOURCE_STATES = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
const SOURCE_MUNICIPALITIES = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PATH = resolve(root, 'drizzle', 'data', `ibge-localidades-${SNAPSHOT_DATE}.json`);
const MIGRATION_PATH = resolve(root, 'drizzle', '0002_seed_ibge.sql');

interface StateRow {
  ibge_code: number;
  uf: string;
  name: string;
}
interface MunicipalityRow {
  ibge_code: number;
  name: string;
  state_code: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readArray(path: string): unknown[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) fail(`${path}: esperado um array JSON`);
  return parsed;
}

function cleanName(value: unknown, what: string): string {
  if (typeof value !== 'string') fail(`${what}: nome ausente`);
  const name = value.normalize('NFC').trim();
  if (name === '') fail(`${what}: nome vazio`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) fail(`${what}: nome com caractere de controle`);
  return name;
}

function parseStates(raw: unknown[]): StateRow[] {
  const rows = raw.map((item): StateRow => {
    if (!isRecord(item)) fail('estado inválido');
    const { id, sigla } = item;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 10 || id > 99) {
      fail('estado com código IBGE inválido');
    }
    if (typeof sigla !== 'string' || !/^[A-Z]{2}$/.test(sigla)) fail(`estado ${id}: UF inválida`);
    return { ibge_code: id, uf: sigla, name: cleanName(item.nome, `estado ${id}`) };
  });
  if (rows.length !== 27) fail(`esperadas 27 UFs, recebidas ${rows.length}`);
  if (new Set(rows.map((r) => r.ibge_code)).size !== 27) fail('códigos de UF duplicados');
  if (new Set(rows.map((r) => r.uf)).size !== 27) fail('siglas de UF duplicadas');
  return rows.sort((a, b) => a.ibge_code - b.ibge_code);
}

function parseMunicipalities(raw: unknown[], states: StateRow[]): MunicipalityRow[] {
  const stateCodes = new Set(states.map((s) => s.ibge_code));
  const rows = raw.map((item): MunicipalityRow => {
    if (!isRecord(item)) fail('município inválido');
    const { id } = item;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1_000_000 || id > 9_999_999) {
      fail('município com código IBGE fora de 7 dígitos');
    }
    // Os 2 primeiros dígitos do código do município são o código da UF.
    const stateCode = Math.floor(id / 100_000);
    if (!stateCodes.has(stateCode)) fail(`município ${id}: UF inexistente`);
    return { ibge_code: id, name: cleanName(item.nome, `município ${id}`), state_code: stateCode };
  });
  if (new Set(rows.map((r) => r.ibge_code)).size !== rows.length) {
    fail('códigos de município duplicados');
  }
  return rows.sort((a, b) => a.ibge_code - b.ibge_code);
}

// Aspas simples dobradas, único escape necessário em literal SQL do SQLite.
function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function batches<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) out.push(rows.slice(i, i + BATCH_SIZE));
  return out;
}

function buildSql(states: StateRow[], municipalities: MunicipalityRow[]): string {
  const statements: string[] = [];
  for (const chunk of batches(states)) {
    const values = chunk
      .map((s) => `(${s.ibge_code}, ${sqlString(s.uf)}, ${sqlString(s.name)})`)
      .join(',\n  ');
    statements.push(`INSERT INTO \`states\` (\`ibge_code\`, \`uf\`, \`name\`) VALUES\n  ${values};`);
  }
  for (const chunk of batches(municipalities)) {
    const values = chunk.map((m) => `(${m.ibge_code}, ${sqlString(m.name)}, ${m.state_code})`).join(',\n  ');
    statements.push(
      `INSERT INTO \`municipalities\` (\`ibge_code\`, \`name\`, \`state_code\`) VALUES\n  ${values};`,
    );
  }
  const header = [
    '-- Seed das localidades IBGE (migration custom: drizzle-kit generate --custom --name seed_ibge).',
    '-- Gerado por apps/api/scripts/build-ibge-seed.ts; não editar à mão.',
    `-- Fonte: ${SOURCE_STATES}`,
    `--        ${SOURCE_MUNICIPALITIES}`,
    `-- Coleta: ${SNAPSHOT_DATE}`,
    `-- Contagens: ${states.length} estados, ${municipalities.length} municípios`,
    `-- Snapshot: drizzle/data/ibge-localidades-${SNAPSHOT_DATE}.json`,
    '',
  ].join('\n');
  return header + statements.join('\n--> statement-breakpoint\n') + '\n';
}

function main(): void {
  const [statesPath, municipalitiesPath] = process.argv.slice(2);
  if (!statesPath || !municipalitiesPath) {
    fail('uso: build-ibge-seed.ts <estados.json> <municipios.json>');
  }
  const states = parseStates(readArray(resolve(statesPath)));
  const municipalities = parseMunicipalities(readArray(resolve(municipalitiesPath)), states);

  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  const snapshot = {
    source: [SOURCE_STATES, SOURCE_MUNICIPALITIES],
    collected_at: SNAPSHOT_DATE,
    states,
    municipalities,
  };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot) + '\n');
  writeFileSync(MIGRATION_PATH, buildSql(states, municipalities));
  console.log(`${states.length} estados, ${municipalities.length} municípios`);
}

main();
