import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { branches, economicGroups, retailNetworks } from '../../src/db/schema.js';
import { toActor, type Actor } from '../../src/domain/shared/authz.js';
import type { Db } from '../../src/domain/shared/db.js';
import { searchKey } from '../../src/domain/shared/normalize.js';

// Códigos IBGE reais do seed.
export const SERRA = 3205002; // ES (32)
export const VITORIA = 3205309; // ES (32)
export const SAO_PAULO = 3550308; // SP (35)
export const ES = 32;
export const SP = 35;

// CNPJs válidos de exemplo (dígitos verificadores corretos).
export const CNPJ_A = '11222333000181';
export const CNPJ_B = '11444777000161';
export const CNPJ_C = '00000000000191';
export const CNPJ_D = '33000167000101';

const NOW = 1_700_000_000_000;

export interface Fixture {
  app: FastifyInstance;
  db: Db;
}

export async function makeFixture(): Promise<Fixture> {
  const app = buildApp(
    loadConfig({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      OIDC_ISSUER: 'https://idp.test',
      OIDC_AUDIENCE: 'meugmill',
    }),
  );
  await app.ready();
  return { app, db: app.db };
}

export function actor(opts: { sub?: string; roles?: string[]; branches?: string[] } = {}): Actor {
  return toActor({
    sub: opts.sub ?? 'user-1',
    roles: opts.roles ?? ['admin'],
    branchIds: opts.branches ?? [],
  });
}

export const adminOf = (...branchCodes: string[]): Actor =>
  actor({ roles: ['admin'], branches: branchCodes });
export const readerOf = (...branchCodes: string[]): Actor =>
  actor({ roles: ['vendedor'], branches: branchCodes });

/** Insere uma filial direto no banco (fixture, sem passar pelas regras). Retorna o id. */
export function seedBranch(db: Db, code: string, opts: { active?: boolean; name?: string } = {}): number {
  return db
    .insert(branches)
    .values({
      code,
      name: opts.name ?? `Filial ${code}`,
      nameKey: searchKey(opts.name ?? `Filial ${code}`),
      municipalityCode: SERRA,
      active: opts.active ?? true,
      deactivatedAt: opts.active === false ? NOW : null,
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'seed',
      updatedBy: 'seed',
    })
    .returning({ id: branches.id })
    .get().id;
}

export function seedRetailNetwork(db: Db, code: string, active = true): number {
  return db
    .insert(retailNetworks)
    .values({
      code,
      name: `Rede ${code}`,
      nameKey: searchKey(`Rede ${code}`),
      active,
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'seed',
      updatedBy: 'seed',
    })
    .returning({ id: retailNetworks.id })
    .get().id;
}

export function seedEconomicGroup(db: Db, code: string): number {
  return db
    .insert(economicGroups)
    .values({
      code,
      name: `Grupo ${code}`,
      nameKey: searchKey(`Grupo ${code}`),
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'seed',
      updatedBy: 'seed',
    })
    .returning({ id: economicGroups.id })
    .get().id;
}

/** Captura o DomainError lançado (ou falha o teste se nada for lançado). */
export function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown';
  }
  return 'no_error';
}
