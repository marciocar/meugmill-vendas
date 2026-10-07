import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config.js';
import * as schema from '../db/schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: BetterSQLite3Database<typeof schema>;
    sqlite: Database.Database;
  }
}

// apps/api/drizzle fica dois níveis acima tanto de src/plugins quanto de dist/plugins.
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export const dbPlugin = fp<{ config: Pick<AppConfig, 'DATABASE_PATH'> }>(
  async (app, opts) => {
    const path = opts.config.DATABASE_PATH;
    const inMemory = path === ':memory:';
    if (!inMemory) mkdirSync(dirname(path), { recursive: true });

    const sqlite = new Database(path);
    try {
      if (!inMemory) sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('foreign_keys = ON');
      sqlite.pragma('busy_timeout = 5000');
      sqlite.pragma('synchronous = NORMAL');

      const db = drizzle(sqlite, { schema });
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      app.decorate('sqlite', sqlite);
      app.decorate('db', db);
    } catch (err) {
      sqlite.close();
      throw err;
    }

    app.addHook('onClose', async () => {
      if (sqlite.open) sqlite.close();
    });
  },
  { name: 'db' },
);
