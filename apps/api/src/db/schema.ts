import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Tabela técnica mínima: prova a cadeia de migration.
export const serviceMeta = sqliteTable('service_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// Colunas comuns a todo cadastro. Timestamps em epoch ms (mesmo critério de service_meta).
// `createdBy`/`updatedBy` guardam o `sub` do token.
const auditColumns = () => ({
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  deactivatedAt: integer('deactivated_at'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
});

// Localidades IBGE (carregadas pela migration de seed).
export const states = sqliteTable('states', {
  ibgeCode: integer('ibge_code').primaryKey(),
  uf: text('uf', { length: 2 }).notNull().unique(),
  name: text('name').notNull(),
});

export const municipalities = sqliteTable(
  'municipalities',
  {
    ibgeCode: integer('ibge_code').primaryKey(),
    name: text('name').notNull(),
    stateCode: integer('state_code')
      .notNull()
      .references(() => states.ibgeCode),
  },
  (t) => [index('municipalities_state_code_name_idx').on(t.stateCode, t.name)],
);

export const branches = sqliteTable('branches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull().default(''),
  municipalityCode: integer('municipality_code')
    .notNull()
    .references(() => municipalities.ibgeCode),
  ...auditColumns(),
});

export const productSubgroups = sqliteTable('product_subgroups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull().default(''),
  ...auditColumns(),
});

export const retailNetworks = sqliteTable('retail_networks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull().default(''),
  ...auditColumns(),
});

export const economicGroups = sqliteTable('economic_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull().default(''),
  ...auditColumns(),
});

export const sellers = sqliteTable('sellers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull().default(''),
  ...auditColumns(),
});

export const sellerBranches = sqliteTable(
  'seller_branches',
  {
    sellerId: integer('seller_id')
      .notNull()
      .references(() => sellers.id, { onDelete: 'cascade' }),
    branchId: integer('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    // Estado do vínculo: inativar um cadastro compartilhado vale só para as filiais do ator.
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    deactivatedAt: integer('deactivated_at'),
    updatedAt: integer('updated_at'),
    updatedBy: text('updated_by'),
  },
  (t) => [
    primaryKey({ columns: [t.sellerId, t.branchId] }),
    // Cobre a listagem com escopo (branch_id in (...)) sem tocar a tabela.
    index('seller_branches_branch_id_seller_id_idx').on(t.branchId, t.sellerId),
  ],
);

export const customers = sqliteTable(
  'customers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    cnpj: text('cnpj', { length: 14 }).notNull().unique(),
    legalName: text('legal_name').notNull(),
    // Chaves de busca: texto em maiúsculas, sem acento e com espaços colapsados (ver searchKey).
    legalNameKey: text('legal_name_key').notNull().default(''),
    tradeName: text('trade_name'),
    tradeNameKey: text('trade_name_key'),
    stateCode: integer('state_code')
      .notNull()
      .references(() => states.ibgeCode),
    municipalityCode: integer('municipality_code')
      .notNull()
      .references(() => municipalities.ibgeCode),
    neighborhood: text('neighborhood').notNull(),
    // Bairro em maiúsculas, sem acento e com espaços colapsados; é o que o E4 compara.
    neighborhoodKey: text('neighborhood_key').notNull(),
    retailNetworkId: integer('retail_network_id').references(() => retailNetworks.id),
    economicGroupId: integer('economic_group_id').references(() => economicGroups.id),
    ...auditColumns(),
  },
  (t) => [
    index('customers_municipality_neighborhood_idx').on(t.municipalityCode, t.neighborhoodKey),
    index('customers_retail_network_id_idx').on(t.retailNetworkId),
    index('customers_economic_group_id_idx').on(t.economicGroupId),
  ],
);

export const customerBranches = sqliteTable(
  'customer_branches',
  {
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    branchId: integer('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    // Estado do vínculo: inativar um cadastro compartilhado vale só para as filiais do ator.
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    deactivatedAt: integer('deactivated_at'),
    updatedAt: integer('updated_at'),
    updatedBy: text('updated_by'),
  },
  (t) => [
    primaryKey({ columns: [t.customerId, t.branchId] }),
    // Cobre a listagem com escopo (branch_id in (...)) sem tocar a tabela.
    index('customer_branches_branch_id_customer_id_idx').on(t.branchId, t.customerId),
  ],
);

export type State = typeof states.$inferSelect;
export type NewState = typeof states.$inferInsert;
export type Municipality = typeof municipalities.$inferSelect;
export type NewMunicipality = typeof municipalities.$inferInsert;
export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
export type ProductSubgroup = typeof productSubgroups.$inferSelect;
export type NewProductSubgroup = typeof productSubgroups.$inferInsert;
export type RetailNetwork = typeof retailNetworks.$inferSelect;
export type NewRetailNetwork = typeof retailNetworks.$inferInsert;
export type EconomicGroup = typeof economicGroups.$inferSelect;
export type NewEconomicGroup = typeof economicGroups.$inferInsert;
export type Seller = typeof sellers.$inferSelect;
export type NewSeller = typeof sellers.$inferInsert;
export type SellerBranch = typeof sellerBranches.$inferSelect;
export type NewSellerBranch = typeof sellerBranches.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type CustomerBranch = typeof customerBranches.$inferSelect;
export type NewCustomerBranch = typeof customerBranches.$inferInsert;
