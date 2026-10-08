import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';
import { importJobLines, importJobs, type ImportJob, type ImportJobLine } from '../../db/schema.js';
import { createBranchService } from '../branches/service.js';
import {
  createEconomicGroupService,
  createProductSubgroupService,
  createRetailNetworkService,
} from '../catalog/service.js';
import { createCustomerService } from '../customers/service.js';
import { createDistributionService } from '../distribution/service.js';
import { createLinkService } from '../links/service.js';
import { createPortfolioService } from '../portfolios/service.js';
import { createSellerService } from '../sellers/service.js';
import { requireAdmin, type Actor } from '../shared/authz.js';
import { writeTx, type Db, type ServiceOptions } from '../shared/db.js';
import { DomainError, invalid, notFound } from '../shared/errors.js';
import { decodeCursor, encodeCursor, resolveLimit, type Page } from '../shared/pagination.js';
import { assertRolesWellFormed } from '../visibility/profiles.js';
import { CsvReader } from './codec.js';
import { IMPORTERS } from './import/registry.js';
import type {
  Expected,
  ImportContext,
  Importer,
  RowFail,
  RowResult,
  Services,
  Unit,
} from './import/types.js';
import { LAYOUTS, bindRows, isLayoutId, type LayoutId, type Row } from './layouts.js';
import {
  MAX_FILE_BYTES,
  MAX_LINES_LIMIT,
  type ImportJobListParams,
  type ImportJobResponse,
  type ImportLineListParams,
  type ImportLineResponse,
} from './schemas.js';

/**
 * Bloco = uma transação; entre blocos a API atende outras requisições. O bloco fecha ao chegar a
 * `chunkRows` linhas OU a `chunkMs` de processamento (uma unidade nunca é partida): cada linha passa pelos
 * serviços de domínio (cerca de 1 ms), e o tempo é o que segura a API.
 */
export const DEFAULT_CHUNK_ROWS = 200;
export const DEFAULT_CHUNK_MS = 50;
/** Prazo para confirmar uma simulação. */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
/** Varredura de simulações vencidas (libera a memória do arquivo mesmo sem ninguém ler o job). */
export const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
/** Jobs abertos (simulando, simulados ou gravando) por usuário. */
export const MAX_OPEN_JOBS = 5;
/** Soma dos arquivos de jobs abertos guardados na memória do processo. */
export const MAX_OPEN_BYTES = 256 * 1024 * 1024;
/** Soma dos arquivos abertos de um mesmo usuário (poucos admins não esgotam o serviço). */
export const MAX_OPEN_BYTES_PER_USER = 48 * 1024 * 1024;
/** Caracteres e registros (vazios inclusive) lidos do arquivo entre duas cessões de vez. */
const PARSE_SLICE = 1_000_000;
const PARSE_RECORDS = 20_000;
/** Páginas copiadas por passo do backup da simulação (~4 MB). */
const BACKUP_PAGES = 1000;
/** Prefixo dos diretórios das cópias de simulação. */
const SNAPSHOT_PREFIX = 'carteira-sim-';
/** Diretório das cópias, ao lado do arquivo do banco (mesmo volume e mesma retenção do banco). */
const SIM_DIR = 'import-sim';
/** Linhas pré-validadas, gravadas no relatório ou carregadas entre duas cessões de vez. */
const ROW_SLICE = 10_000;

const OPEN_STATUSES = ['validating', 'validated', 'applying'] as const;

export interface ImportJobService {
  /** Só o admin importa (403 caso contrário). A rota chama antes de ler o corpo. */
  assertCanImport(actor: Actor): void;
  /** Cria o job (`validating`) e agenda a simulação. Só admin. */
  submit(actor: Actor, layout: string, content: Buffer): ImportJobResponse;
  get(actor: Actor, id: number): ImportJobResponse;
  /** Jobs do próprio usuário, do mais novo para o mais antigo. */
  list(actor: Actor, params?: ImportJobListParams): Page<ImportJobResponse>;
  /** Relatório por linha, em ordem de linha. */
  lines(actor: Actor, id: number, params?: ImportLineListParams): Page<ImportLineResponse>;
  /** Confirma um job `validated` sem erros, com o mesmo escopo de token da simulação, e agenda a gravação. */
  confirm(actor: Actor, id: number): ImportJobResponse;
  /** Cancela um job `validated` ou `invalid`; descarta o arquivo. */
  cancel(actor: Actor, id: number): ImportJobResponse;
  /**
   * Na subida: o arquivo de um job aberto se perdeu com o processo. Job aberto vira `interrupted` (ou
   * `expired`, se já venceu). Devolve quantos mudou.
   */
  recover(): number;
  /** Simulações vencidas viram `expired` e o arquivo sai da memória. Devolve quantas. */
  sweep(): number;
  /** Liga a varredura periódica (timer sem segurar o processo). */
  start(): void;
  /** Para a varredura e faz o job em curso parar no próximo bloco (vira `interrupted`). */
  stop(): void;
  /** Resolve quando a fila esvazia (testes e desligamento). */
  idle(): Promise<void>;
}

export interface ImportJobOptions extends ServiceOptions {
  chunkRows?: number;
  chunkMs?: number;
  ttlMs?: number;
  /** Falha inesperada de um job. Recebe só o id do job e o erro (sem conteúdo do arquivo). */
  onJobError?: (jobId: number, err: unknown) => void;
}

const MALFORMED = 'Número de campos diferente do cabeçalho';
const DUPLICATE = 'Chave repetida no arquivo';
const CHANGED_RESULT = 'Resultado diferente do simulado: simule de novo';
const UNIT_FAILED = 'Carteira não gravada: outra linha dela tem erro';
const SCOPE_CHANGED = 'O perfil ou as filiais do token mudaram desde a simulação: simule de novo';

class UnitRollback extends Error {
  constructor(readonly results: Map<number, RowResult>) {
    super('unit rollback');
  }
}

class Stopped extends Error {
  /** Na gravação, algum bloco já foi gravado antes da parada. */
  constructor(readonly partial: boolean) {
    super('import stopped');
  }
}

interface ActorScope {
  roles: string[];
  branchCodes: string[];
}

const scopeOf = (actor: Actor): ActorScope => ({
  roles: [...new Set(actor.roles)].sort(),
  branchCodes: [...new Set(actor.branchCodes)].sort(),
});

function toResponse(row: ImportJob): ImportJobResponse {
  return {
    id: row.id,
    layout: row.layout as LayoutId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    fileSha256: row.fileSha256,
    fileBytes: row.fileBytes,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    errorRows: row.errorRows,
    counts: JSON.parse(row.counts) as Record<string, number>,
    fileError: row.fileError === null ? null : { message: row.fileError, line: row.fileErrorLine },
    validatedAt: row.validatedAt,
    expiresAt: row.expiresAt,
    confirmedAt: row.confirmedAt,
    finishedAt: row.finishedAt,
  };
}

const yieldLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Importação de CSV (E10).
 *
 * - **Simulação**: roda as escritas reais dos serviços de domínio numa CÓPIA do banco em memória
 *   (`serialize`), bloco a bloco e de forma cumulativa: cada bloco vê o efeito dos anteriores, como na
 *   gravação, e o banco real não fica travado. A cópia é descartada no fim.
 * - **Confirmação**: grava no banco real em blocos (dados + relatório na mesma transação), conferindo
 *   que cada alvo não mudou e que o resultado de cada linha é o simulado.
 * - **Arquivo**: só na memória do processo, enquanto o job está aberto. Nunca vai para o banco.
 * - Uma fila serial por processo (SQLite, instância única).
 */
export function createImportJobService(db: Db, opts: ImportJobOptions = {}): ImportJobService {
  const now = opts.now ?? Date.now;
  const chunkRows = opts.chunkRows ?? DEFAULT_CHUNK_ROWS;
  const chunkMs = opts.chunkMs ?? DEFAULT_CHUNK_MS;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const contents = new Map<number, Buffer>();
  const owners = new Map<number, string>();
  let tail: Promise<void> = Promise.resolve();
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;

  const buildServices = (conn: Db): Services => ({
    branches: createBranchService(conn, opts),
    productSubgroups: createProductSubgroupService(conn, opts),
    retailNetworks: createRetailNetworkService(conn, opts),
    economicGroups: createEconomicGroupService(conn, opts),
    sellers: createSellerService(conn, opts),
    customers: createCustomerService(conn, opts),
    portfolios: createPortfolioService(conn, opts),
    distribution: createDistributionService(conn, opts),
    links: createLinkService(conn, opts),
  });
  const services = buildServices(db);
  const client = (db as unknown as { $client?: Database.Database }).$client;
  /**
   * Diretório das cópias deste banco, ao lado do arquivo dele (limpo na subida). Banco em memória (testes)
   * não tem lugar próprio: a cópia vai para o temporário do sistema e não há limpeza na subida.
   */
  const simRoot = (): string | null =>
    client && !client.memory && client.name ? join(dirname(client.name), SIM_DIR) : null;

  const load = (id: number): ImportJob | undefined =>
    db.select().from(importJobs).where(eq(importJobs.id, id)).get();

  const patch = (conn: Db, id: number, values: Partial<ImportJob>): void => {
    conn
      .update(importJobs)
      .set({ ...values, updatedAt: now() })
      .where(eq(importJobs.id, id))
      .run();
  };

  /** Fim do job: estado terminal e o arquivo sai da memória. */
  const finish = (id: number, values: Partial<ImportJob>): void => {
    contents.delete(id);
    owners.delete(id);
    patch(db, id, { ...values, finishedAt: now() });
  };

  const sweep = (): number => {
    const due = db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(and(eq(importJobs.status, 'validated'), lte(importJobs.expiresAt, now())))
      .all();
    for (const { id } of due) finish(id, { status: 'expired' });
    return due.length;
  };

  const findOwn = (actor: Actor, id: number): ImportJob => {
    const row = load(id);
    if (!row || row.createdBy !== actor.sub) throw notFound();
    if (row.status === 'validated' && row.expiresAt !== null && row.expiresAt <= now()) {
      finish(id, { status: 'expired' });
      return load(id) as ImportJob;
    }
    return row;
  };

  const enqueue = (jobId: number, task: () => Promise<void>): void => {
    tail = tail.then(task).catch((err: unknown) => {
      if (err instanceof Stopped) {
        finish(jobId, { status: err.partial ? 'partially_applied' : 'interrupted' });
        return;
      }
      try {
        finish(jobId, { status: 'failed' });
      } finally {
        opts.onJobError?.(jobId, err);
      }
    });
  };

  // ---- processamento ----

  /** Lê o arquivo em fatias, cedendo a vez entre elas. Erro de arquivo sobe como DomainError. */
  async function readRows(layout: LayoutId, content: Buffer): Promise<Row[]> {
    const reader = new CsvReader(content);
    while (!reader.step(PARSE_SLICE, PARSE_RECORDS)) await yieldLoop();
    const doc = reader.result();
    await yieldLoop();
    return bindRows(LAYOUTS[layout], doc);
  }

  /** Linhas mal formadas e chaves repetidas falham antes de tocar o banco. */
  async function prevalidate(
    importer: Importer,
    rows: Row[],
  ): Promise<{ pre: Map<number, RowFail>; good: Row[] }> {
    const pre = new Map<number, RowFail>();
    const byKey = new Map<string, number[]>();
    for (let i = 0; i < rows.length; i++) {
      if (i > 0 && i % ROW_SLICE === 0) await yieldLoop();
      const r = rows[i] as Row;
      if (r.malformed) {
        pre.set(r.line, { ok: false, code: 'malformed_row', message: MALFORMED });
        continue;
      }
      const key = importer.keyOf(r);
      if (key === null) continue;
      const list = byKey.get(key);
      if (list) list.push(r.line);
      else byKey.set(key, [r.line]);
    }
    for (const lines of byKey.values()) {
      if (lines.length < 2) continue;
      for (const line of lines) pre.set(line, { ok: false, code: 'duplicate_key', message: DUPLICATE });
    }
    return { pre, good: rows.filter((r) => !pre.has(r.line)) };
  }

  /** Uma unidade num savepoint: qualquer linha com erro (ou diferente do simulado) desfaz a unidade inteira. */
  function runUnit(
    conn: Db,
    importer: Importer,
    base: Omit<ImportContext, 'stats'>,
    unit: Unit,
    stats: Record<string, number>,
  ): Map<number, RowResult> {
    const unitStats: Record<string, number> = {};
    const ctx: ImportContext = { ...base, stats: unitStats };
    let results: Map<number, RowResult>;
    try {
      results = conn.transaction(() => {
        const r = importer.apply(ctx, unit);
        if (base.expected) {
          for (const [line, res] of r) {
            const exp = base.expected.get(line);
            if (res.ok && (!exp || exp.action !== res.action || exp.activation !== res.activation)) {
              r.set(line, { ok: false, code: 'changed_since_validation', message: CHANGED_RESULT });
            }
          }
        }
        if ([...r.values()].some((x) => !x.ok)) {
          // A unidade é desfeita inteira: nenhuma linha dela pode sair como gravada no relatório.
          for (const [line, res] of r) {
            if (res.ok) r.set(line, { ok: false, code: 'validation_error', message: UNIT_FAILED });
          }
          throw new UnitRollback(r);
        }
        return r;
      });
    } catch (err) {
      if (err instanceof UnitRollback) return err.results;
      throw err;
    }
    for (const [k, v] of Object.entries(unitStats)) stats[k] = (stats[k] ?? 0) + v;
    return results;
  }

  function tally(counts: Record<string, number>, results: Map<number, RowResult>): number {
    let errors = 0;
    for (const r of results.values()) {
      if (!r.ok) {
        errors++;
        continue;
      }
      counts[r.action] = (counts[r.action] ?? 0) + 1;
      if (r.activation) counts[r.activation] = (counts[r.activation] ?? 0) + 1;
    }
    return errors;
  }

  function saveLines(jobId: number, results: Map<number, RowResult>, phase: 'simulate' | 'apply'): void {
    if (results.size === 0) return;
    const values = [...results.entries()].map(([line, r]) => ({
      jobId,
      line,
      status: r.ok
        ? phase === 'simulate'
          ? ('valid' as const)
          : ('applied' as const)
        : phase === 'simulate'
          ? ('invalid' as const)
          : ('failed' as const),
      action: r.ok ? r.action : null,
      activation: r.ok ? r.activation : null,
      errorCode: r.ok ? null : r.code,
      message: r.ok ? null : r.message,
      warning: r.ok ? r.warning : null,
      targetId: r.ok ? r.targetId : null,
      targetVersion: r.ok ? r.targetVersion : null,
    }));
    // Lotes de 500 (10 colunas): longe do limite de variáveis do SQLite.
    for (let i = 0; i < values.length; i += 500) {
      db.insert(importJobLines)
        .values(values.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [importJobLines.jobId, importJobLines.line],
          set: {
            status: sql`excluded.status`,
            // A confirmação mantém a ação, o alvo e a versão vistos na simulação quando a linha falha.
            action: sql`coalesce(excluded.action, ${importJobLines.action})`,
            activation: sql`case when excluded.status = 'applied' then excluded.activation else ${importJobLines.activation} end`,
            errorCode: sql`excluded.error_code`,
            message: sql`excluded.message`,
            warning: sql`coalesce(excluded.warning, ${importJobLines.warning})`,
            targetId: sql`coalesce(excluded.target_id, ${importJobLines.targetId})`,
            targetVersion: sql`coalesce(excluded.target_version, ${importJobLines.targetVersion})`,
          },
        })
        .run();
    }
  }

  /** Grava um mapa grande no relatório em fatias, cedendo a vez entre elas. */
  async function saveLinesSliced(
    jobId: number,
    results: Map<number, RowResult>,
    phase: 'simulate' | 'apply',
  ) {
    const entries = [...results.entries()];
    for (let i = 0; i < entries.length; i += ROW_SLICE) {
      saveLines(jobId, new Map(entries.slice(i, i + ROW_SLICE)), phase);
      await yieldLoop();
    }
  }

  /** O que a simulação viu e previu, por linha, carregado em fatias. */
  async function loadExpected(jobId: number, maxLine: number): Promise<Map<number, Expected>> {
    const out = new Map<number, Expected>();
    for (let from = 0; from <= maxLine; from += ROW_SLICE) {
      const rows = db
        .select({
          line: importJobLines.line,
          targetId: importJobLines.targetId,
          targetVersion: importJobLines.targetVersion,
          action: importJobLines.action,
          activation: importJobLines.activation,
        })
        .from(importJobLines)
        .where(
          and(
            eq(importJobLines.jobId, jobId),
            gte(importJobLines.line, from),
            lt(importJobLines.line, from + ROW_SLICE),
          ),
        )
        .all();
      for (const l of rows) {
        out.set(l.line, {
          targetId: l.targetId,
          targetVersion: l.targetVersion,
          action: l.action as Expected['action'],
          activation: l.activation as Expected['activation'],
        });
      }
      await yieldLoop();
    }
    return out;
  }

  /** Cópia do banco em memória para a simulação (descartada no fim). */
  async function snapshot(): Promise<{ conn: Db; close: () => void }> {
    // O `drizzle()` do better-sqlite3 expõe a conexão em `$client` (fora do tipo `Db`).
    if (!client) throw new Error('conexão SQLite indisponível para a simulação');
    // `backup` copia por páginas em passos e cede a vez entre eles: o custo não trava a API, por maior que
    // seja o banco. A cópia vai para um diretório temporário próprio, apagado no fim.
    const own = simRoot();
    if (own) mkdirSync(own, { recursive: true, mode: 0o700 });
    const dir = mkdtempSync(join(own ?? tmpdir(), SNAPSHOT_PREFIX));
    const drop = () => rmSync(dir, { recursive: true, force: true });
    try {
      await client.backup(join(dir, 'copia.sqlite'), { progress: () => BACKUP_PAGES });
      const copy = new Database(join(dir, 'copia.sqlite'));
      copy.pragma('journal_mode = MEMORY');
      copy.pragma('synchronous = OFF');
      copy.pragma('foreign_keys = ON');
      return {
        conn: drizzle(copy, { schema }),
        close: () => {
          copy.close();
          drop();
        },
      };
    } catch (err) {
      drop();
      throw err;
    }
  }

  async function process(jobId: number, actor: Actor, phase: 'simulate' | 'apply'): Promise<void> {
    const job = load(jobId);
    const expectedStatus = phase === 'simulate' ? 'validating' : 'applying';
    const content = contents.get(jobId);
    if (!job || job.status !== expectedStatus) return;
    if (!content) throw new Error('arquivo do job ausente');
    const layout = job.layout as LayoutId;
    const importer = IMPORTERS[layout];

    let rows: Row[];
    try {
      rows = await readRows(layout, content);
    } catch (err) {
      if (!(err instanceof DomainError) || phase === 'apply') throw err;
      const line = err.detail?.line;
      finish(jobId, {
        status: 'invalid',
        fileError: err.message,
        fileErrorLine: typeof line === 'number' ? line : null,
      });
      return;
    }

    const lastLine = rows.length > 0 ? (rows[rows.length - 1] as Row).line : 0;
    const expected = phase === 'apply' ? await loadExpected(jobId, lastLine) : undefined;
    const { pre, good } = await prevalidate(importer, rows);
    const counts: Record<string, number> = {};
    let errors = tally(counts, pre);
    await saveLinesSliced(jobId, pre, phase);
    patch(db, jobId, { totalRows: rows.length, processedRows: pre.size, errorRows: errors, counts: '{}' });
    await yieldLoop();

    const units = importer.units ? importer.units(good) : good.map((r) => ({ rows: [r] }));
    const sim = phase === 'simulate' ? await snapshot() : undefined;
    const conn = sim?.conn ?? db;
    const base = {
      db: conn,
      actor,
      services: sim ? buildServices(sim.conn) : services,
      ...(expected ? { expected } : {}),
    };
    let processed = pre.size;
    let appliedAny = false;
    try {
      let next = 0;
      while (next < units.length) {
        if (stopping) throw new Stopped(phase === 'apply' && appliedAny);
        const results = new Map<number, RowResult>();
        const stats: Record<string, number> = {};
        const runChunk = () => {
          const started = performance.now();
          let size = 0;
          while (next < units.length) {
            const unit = units[next] as Unit;
            if (size > 0 && (size + unit.rows.length > chunkRows || performance.now() - started >= chunkMs))
              break;
            for (const [line, r] of runUnit(conn, importer, base, unit, stats)) results.set(line, r);
            size += unit.rows.length;
            next++;
          }
        };
        const record = () => {
          errors += tally(counts, results);
          for (const [k, v] of Object.entries(stats)) counts[k] = (counts[k] ?? 0) + v;
          processed += results.size;
          if ([...results.values()].some((r) => r.ok)) appliedAny = true;
          saveLines(jobId, results, phase);
          patch(db, jobId, { processedRows: processed, errorRows: errors, counts: JSON.stringify(counts) });
        };
        if (sim) {
          // Simulação: o bloco fica gravado só na cópia (cumulativo); o relatório vai para o banco real.
          writeTx(sim.conn, runChunk);
          writeTx(db, record);
        } else {
          // Gravação: dados e relatório do bloco na MESMA transação.
          writeTx(db, () => {
            runChunk();
            record();
          });
        }
        await yieldLoop();
      }
    } finally {
      sim?.close();
    }

    if (phase === 'simulate') {
      const at = now();
      if (errors > 0) {
        finish(jobId, { status: 'invalid', validatedAt: at, expiresAt: null });
      } else {
        patch(db, jobId, { status: 'validated', validatedAt: at, expiresAt: at + ttlMs });
      }
    } else {
      finish(jobId, { status: errors > 0 ? 'partially_applied' : 'applied' });
    }
  }

  // ---- API do serviço ----

  const assertCanImport = (actor: Actor): void => {
    assertRolesWellFormed(actor, opts);
    requireAdmin(actor);
  };

  return {
    assertCanImport,

    submit(actor, layout, content) {
      assertCanImport(actor);
      if (!isLayoutId(layout)) throw invalid('Layout inválido');
      if (content.length === 0) throw invalid('Arquivo vazio');
      if (content.length > MAX_FILE_BYTES) throw invalid('Arquivo maior que o permitido');
      sweep();
      let openBytes = 0;
      let mine = 0;
      for (const [jobId, c] of contents) {
        openBytes += c.length;
        if (owners.get(jobId) === actor.sub) mine += c.length;
      }
      if (mine + content.length > MAX_OPEN_BYTES_PER_USER) {
        throw new DomainError(
          'too_many_imports',
          'Há importações demais em aberto: confirme ou cancele antes',
        );
      }
      if (openBytes + content.length > MAX_OPEN_BYTES) {
        throw new DomainError(
          'too_many_imports',
          'Importações demais em aberto no serviço: tente mais tarde',
        );
      }
      const at = now();
      const id = writeTx(db, (tx) => {
        const open = tx
          .select({ n: sql<number>`count(*)` })
          .from(importJobs)
          .where(and(eq(importJobs.createdBy, actor.sub), inArray(importJobs.status, [...OPEN_STATUSES])))
          .get();
        if ((open?.n ?? 0) >= MAX_OPEN_JOBS) {
          throw new DomainError(
            'too_many_imports',
            'Há importações demais em aberto: confirme ou cancele antes',
          );
        }
        return tx
          .insert(importJobs)
          .values({
            layout,
            status: 'validating',
            createdBy: actor.sub,
            createdAt: at,
            updatedAt: at,
            fileSha256: createHash('sha256').update(content).digest('hex'),
            fileBytes: content.length,
            actorScope: JSON.stringify(scopeOf(actor)),
          })
          .returning({ id: importJobs.id })
          .get().id;
      });
      contents.set(id, content);
      owners.set(id, actor.sub);
      enqueue(id, () => process(id, actor, 'simulate'));
      return toResponse(load(id) as ImportJob);
    },

    get(actor, id) {
      assertRolesWellFormed(actor, opts);
      return toResponse(findOwn(actor, id));
    },

    list(actor, params = {}) {
      assertRolesWellFormed(actor, opts);
      sweep();
      const limit = resolveLimit(params.limit);
      const before = decodeCursor(params.cursor);
      const rows = db
        .select()
        .from(importJobs)
        .where(
          and(
            eq(importJobs.createdBy, actor.sub),
            before === undefined ? undefined : lt(importJobs.id, before),
          ),
        )
        .orderBy(desc(importJobs.id))
        .limit(limit + 1)
        .all();
      const items = rows.slice(0, limit).map(toResponse);
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null };
    },

    lines(actor, id, params = {}) {
      assertRolesWellFormed(actor, opts);
      findOwn(actor, id);
      const limit = params.limit ?? 200;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LINES_LIMIT)
        throw invalid('Campo inválido: limit');
      const after = decodeCursor(params.cursor);
      const rows = db
        .select()
        .from(importJobLines)
        .where(
          and(
            eq(importJobLines.jobId, id),
            params.status === undefined
              ? undefined
              : eq(importJobLines.status, params.status as ImportJobLine['status']),
            after === undefined ? undefined : gt(importJobLines.line, after),
          ),
        )
        .orderBy(asc(importJobLines.line))
        .limit(limit + 1)
        .all();
      const items = rows.slice(0, limit).map((l): ImportLineResponse => ({
        line: l.line,
        status: l.status,
        action: l.action as ImportLineResponse['action'],
        activation: l.activation as ImportLineResponse['activation'],
        errorCode: l.errorCode,
        message: l.message,
        warning: l.warning,
      }));
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.line) : null };
    },

    confirm(actor, id) {
      assertRolesWellFormed(actor, opts);
      requireAdmin(actor);
      const row = findOwn(actor, id);
      if (row.status !== 'validated' || row.errorRows > 0 || !contents.has(id)) {
        throw new DomainError(
          'import_not_ready',
          'Só uma simulação concluída e sem erros pode ser confirmada',
        );
      }
      // A simulação vale para o escopo do token dela: outro escopo muda o resultado (ex.: `linked` × `update`).
      if (row.actorScope !== JSON.stringify(scopeOf(actor))) {
        throw new DomainError('import_not_ready', SCOPE_CHANGED);
      }
      patch(db, id, { status: 'applying', confirmedBy: actor.sub, confirmedAt: now(), processedRows: 0 });
      enqueue(id, () => process(id, actor, 'apply'));
      return toResponse(load(id) as ImportJob);
    },

    cancel(actor, id) {
      assertRolesWellFormed(actor, opts);
      const row = findOwn(actor, id);
      if (row.status !== 'validated' && row.status !== 'invalid') {
        throw new DomainError('import_not_ready', 'Só uma simulação concluída pode ser cancelada');
      }
      if (row.status === 'validated') finish(id, { status: 'cancelled' });
      return toResponse(load(id) as ImportJob);
    },

    recover() {
      // Cópias de simulação que sobraram de um processo morto (o `close` não rodou). O diretório é só deste
      // banco, então nenhuma outra instância está usando.
      const own = simRoot();
      if (own) rmSync(own, { recursive: true, force: true });
      const at = now();
      const expired = db
        .update(importJobs)
        .set({ status: 'expired', finishedAt: at, updatedAt: at })
        .where(and(eq(importJobs.status, 'validated'), lte(importJobs.expiresAt, at)))
        .run().changes;
      const interrupted = db
        .update(importJobs)
        .set({ status: 'interrupted', finishedAt: at, updatedAt: at })
        .where(inArray(importJobs.status, [...OPEN_STATUSES]))
        .run().changes;
      return expired + interrupted;
    },

    sweep,

    start() {
      if (timer) return;
      timer = setInterval(() => {
        try {
          sweep();
        } catch (err) {
          opts.onJobError?.(0, err);
        }
      }, SWEEP_INTERVAL_MS);
      timer.unref();
    },

    stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    },

    idle: () => tail,
  };
}
