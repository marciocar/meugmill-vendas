import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
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
import { parseCsv } from './codec.js';
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
/** Jobs abertos (simulando, simulados ou gravando) por usuário. */
export const MAX_OPEN_JOBS = 5;

const OPEN_STATUSES = ['validating', 'validated', 'applying'] as const;

export interface ImportJobService {
  /** Cria o job (`validating`) e agenda a simulação. Só admin. */
  submit(actor: Actor, layout: string, content: Buffer): ImportJobResponse;
  get(actor: Actor, id: number): ImportJobResponse;
  /** Jobs do próprio usuário, do mais novo para o mais antigo. */
  list(actor: Actor, params?: ImportJobListParams): Page<ImportJobResponse>;
  /** Relatório por linha, em ordem de linha. */
  lines(actor: Actor, id: number, params?: ImportLineListParams): Page<ImportLineResponse>;
  /** Confirma um job `validated` sem erros e agenda a gravação. */
  confirm(actor: Actor, id: number): ImportJobResponse;
  /** Cancela um job `validated` ou `invalid`; apaga o conteúdo. */
  cancel(actor: Actor, id: number): ImportJobResponse;
  /** Na subida: job no meio vira `interrupted` e simulação vencida vira `expired`. Devolve quantos mudou. */
  recover(): number;
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
const UNIT_ROLLBACK = Symbol('unit-rollback');
const SIMULATION_ROLLBACK = Symbol('simulation-rollback');

class UnitRollback extends Error {
  readonly tag = UNIT_ROLLBACK;
  constructor(readonly results: Map<number, RowResult>) {
    super('unit rollback');
  }
}

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
 * Importação de CSV (E10). A simulação roda as escritas reais dos serviços de domínio numa transação
 * desfeita; a confirmação grava em blocos, conferindo que cada alvo não mudou desde a simulação.
 * Uma fila serial por processo (SQLite, instância única).
 */
export function createImportJobService(db: Db, opts: ImportJobOptions = {}): ImportJobService {
  const now = opts.now ?? Date.now;
  const chunkRows = opts.chunkRows ?? DEFAULT_CHUNK_ROWS;
  const chunkMs = opts.chunkMs ?? DEFAULT_CHUNK_MS;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  let tail: Promise<void> = Promise.resolve();

  const services: Services = {
    branches: createBranchService(db, opts),
    productSubgroups: createProductSubgroupService(db, opts),
    retailNetworks: createRetailNetworkService(db, opts),
    economicGroups: createEconomicGroupService(db, opts),
    sellers: createSellerService(db, opts),
    customers: createCustomerService(db, opts),
    portfolios: createPortfolioService(db, opts),
    distribution: createDistributionService(db, opts),
    links: createLinkService(db, opts),
  };

  const load = (id: number): ImportJob | undefined =>
    db.select().from(importJobs).where(eq(importJobs.id, id)).get();

  const patch = (id: number, values: Partial<ImportJob>): void => {
    db.update(importJobs)
      .set({ ...values, updatedAt: now() })
      .where(eq(importJobs.id, id))
      .run();
  };

  /** Simulação vencida vira `expired` (e perde o conteúdo) na primeira leitura depois do prazo. */
  const expireIfDue = (row: ImportJob): ImportJob => {
    if (row.status !== 'validated' || row.expiresAt === null || row.expiresAt > now()) return row;
    patch(row.id, { status: 'expired', content: null, finishedAt: now() });
    return load(row.id) as ImportJob;
  };

  const findOwn = (actor: Actor, id: number): ImportJob => {
    const row = load(id);
    if (!row || row.createdBy !== actor.sub) throw notFound();
    return expireIfDue(row);
  };

  const enqueue = (jobId: number, task: () => Promise<void>): void => {
    tail = tail.then(task).catch((err: unknown) => {
      try {
        patch(jobId, { status: 'failed', content: null, finishedAt: now() });
      } finally {
        opts.onJobError?.(jobId, err);
      }
    });
  };

  // ---- processamento ----

  /** Linhas mal formadas e chaves repetidas falham antes de tocar o banco. */
  function prevalidate(importer: Importer, rows: Row[]): { pre: Map<number, RowFail>; good: Row[] } {
    const pre = new Map<number, RowFail>();
    const byKey = new Map<string, Row[]>();
    for (const r of rows) {
      if (r.malformed) {
        pre.set(r.line, { ok: false, code: 'malformed_row', message: MALFORMED });
        continue;
      }
      const key = importer.keyOf(r);
      if (key === null) continue;
      const list = byKey.get(key);
      if (list) list.push(r);
      else byKey.set(key, [r]);
    }
    for (const list of byKey.values()) {
      if (list.length < 2) continue;
      for (const r of list) pre.set(r.line, { ok: false, code: 'duplicate_key', message: DUPLICATE });
    }
    return { pre, good: rows.filter((r) => !pre.has(r.line)) };
  }

  /** Uma unidade num savepoint: qualquer linha com erro desfaz a unidade inteira. */
  function runUnit(
    importer: Importer,
    base: Omit<ImportContext, 'stats'>,
    unit: Unit,
    stats: Record<string, number>,
  ): Map<number, RowResult> {
    const unitStats: Record<string, number> = {};
    const ctx: ImportContext = { ...base, stats: unitStats };
    let results: Map<number, RowResult>;
    try {
      results = db.transaction(() => {
        const r = importer.apply(ctx, unit);
        if ([...r.values()].some((x) => !x.ok)) throw new UnitRollback(r);
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
            action: sql`excluded.action`,
            activation: sql`excluded.activation`,
            errorCode: sql`excluded.error_code`,
            message: sql`excluded.message`,
            warning: sql`excluded.warning`,
            // A confirmação mantém o alvo visto na simulação.
            targetId: sql`coalesce(excluded.target_id, ${importJobLines.targetId})`,
            targetVersion: sql`coalesce(excluded.target_version, ${importJobLines.targetVersion})`,
          },
        })
        .run();
    }
  }

  /** Lê e confere o arquivo do job. Erro de arquivo devolve a mensagem e a linha. */
  function readRows(job: ImportJob): Row[] {
    if (!job.content) throw new Error('job sem conteúdo');
    return bindRows(LAYOUTS[job.layout as LayoutId], parseCsv(job.content));
  }

  async function process(jobId: number, actor: Actor, phase: 'simulate' | 'apply'): Promise<void> {
    const job = load(jobId);
    const expectedStatus = phase === 'simulate' ? 'validating' : 'applying';
    if (!job || job.status !== expectedStatus) return;
    const importer = IMPORTERS[job.layout as LayoutId];

    let rows: Row[];
    try {
      rows = readRows(job);
    } catch (err) {
      if (!(err instanceof DomainError) || phase === 'apply') throw err;
      const line = err.detail?.line;
      patch(jobId, {
        status: 'invalid',
        content: null,
        fileError: err.message,
        fileErrorLine: typeof line === 'number' ? line : null,
        finishedAt: now(),
      });
      return;
    }

    let expected: Map<number, Expected> | undefined;
    if (phase === 'apply') {
      expected = new Map(
        db
          .select({
            line: importJobLines.line,
            targetId: importJobLines.targetId,
            targetVersion: importJobLines.targetVersion,
          })
          .from(importJobLines)
          .where(eq(importJobLines.jobId, jobId))
          .all()
          .map((l) => [l.line, { targetId: l.targetId, targetVersion: l.targetVersion }]),
      );
    }

    const { pre, good } = prevalidate(importer, rows);
    const counts: Record<string, number> = {};
    let errors = tally(counts, pre);
    saveLines(jobId, pre, phase);
    patch(jobId, { totalRows: rows.length, processedRows: pre.size, errorRows: errors, counts: '{}' });

    const units = importer.units ? importer.units(good) : good.map((r) => ({ rows: [r] }));
    const base = { db, actor, services, ...(expected ? { expected } : {}) };
    let processed = pre.size;
    let next = 0;
    while (next < units.length) {
      const results = new Map<number, RowResult>();
      const stats: Record<string, number> = {};
      const runChunk = () => {
        const started = performance.now();
        let size = 0;
        while (next < units.length) {
          const unit = units[next] as Unit;
          if (size > 0 && (size + unit.rows.length > chunkRows || performance.now() - started >= chunkMs))
            break;
          for (const [line, r] of runUnit(importer, base, unit, stats)) results.set(line, r);
          size += unit.rows.length;
          next++;
        }
      };
      if (phase === 'simulate') {
        try {
          writeTx(db, () => {
            runChunk();
            throw SIMULATION_ROLLBACK;
          });
        } catch (err) {
          if (err !== SIMULATION_ROLLBACK) throw err;
        }
      } else {
        writeTx(db, runChunk);
      }
      errors += tally(counts, results);
      for (const [k, v] of Object.entries(stats)) counts[k] = (counts[k] ?? 0) + v;
      processed += results.size;
      saveLines(jobId, results, phase);
      patch(jobId, { processedRows: processed, errorRows: errors, counts: JSON.stringify(counts) });
      await yieldLoop();
    }

    const at = now();
    if (phase === 'simulate') {
      patch(jobId, {
        status: errors > 0 ? 'invalid' : 'validated',
        validatedAt: at,
        ...(errors > 0 ? { content: null, finishedAt: at, expiresAt: null } : { expiresAt: at + ttlMs }),
      });
    } else {
      patch(jobId, { status: errors > 0 ? 'partially_applied' : 'applied', content: null, finishedAt: at });
    }
  }

  // ---- API do serviço ----

  return {
    submit(actor, layout, content) {
      assertRolesWellFormed(actor, opts);
      requireAdmin(actor);
      if (!isLayoutId(layout)) throw invalid('Layout inválido');
      if (content.length === 0) throw invalid('Arquivo vazio');
      if (content.length > MAX_FILE_BYTES) throw invalid('Arquivo maior que o permitido');
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
            content,
          })
          .returning({ id: importJobs.id })
          .get().id;
      });
      enqueue(id, () => process(id, actor, 'simulate'));
      return toResponse(load(id) as ImportJob);
    },

    get(actor, id) {
      assertRolesWellFormed(actor, opts);
      return toResponse(findOwn(actor, id));
    },

    list(actor, params = {}) {
      assertRolesWellFormed(actor, opts);
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
        .all()
        .map(expireIfDue);
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
      if (row.status !== 'validated' || row.errorRows > 0) {
        throw new DomainError(
          'import_not_ready',
          'Só uma simulação concluída e sem erros pode ser confirmada',
        );
      }
      const at = now();
      patch(id, { status: 'applying', confirmedBy: actor.sub, confirmedAt: at, processedRows: 0 });
      enqueue(id, () => process(id, actor, 'apply'));
      return toResponse(load(id) as ImportJob);
    },

    cancel(actor, id) {
      assertRolesWellFormed(actor, opts);
      const row = findOwn(actor, id);
      if (row.status !== 'validated' && row.status !== 'invalid') {
        throw new DomainError('import_not_ready', 'Só uma simulação concluída pode ser cancelada');
      }
      if (row.status === 'validated') patch(id, { status: 'cancelled', content: null, finishedAt: now() });
      return toResponse(load(id) as ImportJob);
    },

    recover() {
      const at = now();
      const interrupted = db
        .update(importJobs)
        .set({ status: 'interrupted', content: null, finishedAt: at, updatedAt: at })
        .where(inArray(importJobs.status, ['validating', 'applying']))
        .run().changes;
      const expired = db
        .update(importJobs)
        .set({ status: 'expired', content: null, finishedAt: at, updatedAt: at })
        .where(and(eq(importJobs.status, 'validated'), lt(importJobs.expiresAt, at + 1)))
        .run().changes;
      return interrupted + expired;
    },

    idle: () => tail,
  };
}
