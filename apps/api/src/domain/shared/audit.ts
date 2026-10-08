import { Type } from '@sinclair/typebox';
import { eq, sql } from 'drizzle-orm';
import type { branches } from '../../db/schema.js';
import type { Conn } from './db.js';
import { DomainError } from './errors.js';

/** Campos de auditoria expostos nas respostas (sem created_by/updated_by: minimização). */
export const AuditResponseFields = {
  active: Type.Boolean(),
  deactivatedAt: Type.Union([Type.Integer(), Type.Null()]),
  version: Type.Integer(),
  createdAt: Type.Integer(),
  updatedAt: Type.Integer(),
};

interface AuditRow {
  active: boolean;
  deactivatedAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export function auditFields(row: AuditRow): AuditRow {
  return {
    active: row.active,
    deactivatedAt: row.deactivatedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function requireVersion(expected: number | undefined | null): number {
  if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 1) {
    throw new DomainError('precondition_required', 'Versão esperada obrigatória (If-Match)');
  }
  return expected;
}

export function assertVersion(current: number, expected: number): void {
  if (current !== expected) {
    throw new DomainError('version_conflict', 'O registro foi alterado por outra operação');
  }
}

/** Todas as tabelas de cadastro têm estas colunas; o tipo de `branches` serve de molde. */
export type AuditedTable = typeof branches;

/** Liga/desliga o registro e incrementa a versão. */
export function writeActive(
  conn: Conn,
  table: AuditedTable,
  id: number,
  active: boolean,
  sub: string,
  now: number,
): void {
  conn
    .update(table)
    .set({
      active,
      deactivatedAt: active ? null : now,
      version: sql`${table.version} + 1`,
      updatedAt: now,
      updatedBy: sub,
    })
    .where(eq(table.id, id))
    .run();
}
