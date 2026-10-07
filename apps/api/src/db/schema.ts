import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Tabela técnica mínima: prova a cadeia de migration. O domínio de negócio entra a partir da E2.
export const serviceMeta = sqliteTable('service_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
