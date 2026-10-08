import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
    // Candidatos por UF no motor de elegibilidade/conflitos (E4/E5).
    index('customers_state_code_idx').on(t.stateCode),
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

export const portfolioTypes = sqliteTable('portfolio_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull().default(''),
  ...auditColumns(),
});

export const portfolios = sqliteTable(
  'portfolios',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    branchId: integer('branch_id')
      .notNull()
      .references(() => branches.id),
    name: text('name').notNull(),
    // Unicidade do nome por filial é sobre a chave normalizada (ver searchKey).
    nameKey: text('name_key').notNull().default(''),
    description: text('description'),
    // `sub` do token do responsável.
    responsibleSub: text('responsible_sub').notNull(),
    portfolioTypeId: integer('portfolio_type_id')
      .notNull()
      .references(() => portfolioTypes.id),
    // Ciclo do wizard; independente de `active` (inativação).
    status: text('status', { enum: ['draft', 'active'] })
      .notNull()
      .default('draft'),
    // Última finalização que mudou os vínculos (E7); null enquanto rascunho.
    finalizedAt: integer('finalized_at'),
    finalizedBy: text('finalized_by'),
    ...auditColumns(),
  },
  (t) => [
    unique('portfolios_branch_id_name_key_unique').on(t.branchId, t.nameKey),
    index('portfolios_responsible_sub_idx').on(t.responsibleSub),
    index('portfolios_portfolio_type_id_idx').on(t.portfolioTypeId),
    check('portfolios_status_check', sql`${t.status} in ('draft', 'active')`),
  ],
);

export const portfolioRegions = sqliteTable(
  'portfolio_regions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    portfolioId: integer('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    level: text('level', { enum: ['state', 'municipality', 'neighborhood'] }).notNull(),
    stateCode: integer('state_code')
      .notNull()
      .references(() => states.ibgeCode),
    municipalityCode: integer('municipality_code').references(() => municipalities.ibgeCode),
    neighborhoodKey: text('neighborhood_key'),
    neighborhoodLabel: text('neighborhood_label'),
    // Chave canônica da região, derivada pelo banco: duplicatas de UF/município também colidam.
    regionKey: text('region_key').generatedAlwaysAs(
      sql`"level" || ':' || "state_code" || ':' || coalesce("municipality_code", 0) || ':' || coalesce("neighborhood_key", '')`,
      { mode: 'stored' },
    ),
  },
  (t) => [
    check(
      'portfolio_regions_level_check',
      sql`(${t.level} = 'state' and ${t.municipalityCode} is null and ${t.neighborhoodKey} is null and ${t.neighborhoodLabel} is null)
        or (${t.level} = 'municipality' and ${t.municipalityCode} is not null and ${t.neighborhoodKey} is null and ${t.neighborhoodLabel} is null)
        or (${t.level} = 'neighborhood' and ${t.municipalityCode} is not null and ${t.neighborhoodKey} is not null and ${t.neighborhoodKey} <> '' and ${t.neighborhoodLabel} is not null)`,
    ),
    // Colunas anuláveis não colidem em UNIQUE no SQLite; `region_key` (gerada) as normaliza.
    uniqueIndex('portfolio_regions_portfolio_id_region_key_unique').on(t.portfolioId, t.regionKey),
  ],
);

export const portfolioRetailNetworks = sqliteTable(
  'portfolio_retail_networks',
  {
    portfolioId: integer('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    retailNetworkId: integer('retail_network_id')
      .notNull()
      .references(() => retailNetworks.id),
  },
  (t) => [primaryKey({ columns: [t.portfolioId, t.retailNetworkId] })],
);

export const portfolioEconomicGroups = sqliteTable(
  'portfolio_economic_groups',
  {
    portfolioId: integer('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    economicGroupId: integer('economic_group_id')
      .notNull()
      .references(() => economicGroups.id),
  },
  (t) => [primaryKey({ columns: [t.portfolioId, t.economicGroupId] })],
);

export const portfolioSellers = sqliteTable(
  'portfolio_sellers',
  {
    portfolioId: integer('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    sellerId: integer('seller_id')
      .notNull()
      .references(() => sellers.id),
    productSubgroupId: integer('product_subgroup_id')
      .notNull()
      .references(() => productSubgroups.id),
  },
  (t) => [
    primaryKey({ columns: [t.portfolioId, t.sellerId, t.productSubgroupId] }),
    index('portfolio_sellers_seller_id_idx').on(t.sellerId),
    index('portfolio_sellers_product_subgroup_id_idx').on(t.productSubgroupId),
  ],
);

// Ajustes manuais da prévia (E4): inclui cliente que não casa os filtros ou exclui um que casa.
// A PK (carteira, cliente) garante a exclusão mútua entre inclusão e exclusão.
export const portfolioCustomerOverrides = sqliteTable(
  'portfolio_customer_overrides',
  {
    portfolioId: integer('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    kind: text('kind', { enum: ['include', 'exclude'] }).notNull(),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.portfolioId, t.customerId] }),
    index('portfolio_customer_overrides_customer_id_idx').on(t.customerId),
    check('portfolio_customer_overrides_kind_check', sql`${t.kind} in ('include', 'exclude')`),
  ],
);

// Atribuições do E6 (rascunho): vendedor de cada cliente em cada subgrupo da carteira. A PK garante
// um único vendedor por (cliente, subgrupo). A validade é decidida na leitura (domain/distribution).
export const portfolioAssignments = sqliteTable(
  'portfolio_assignments',
  {
    portfolioId: integer('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    productSubgroupId: integer('product_subgroup_id')
      .notNull()
      .references(() => productSubgroups.id),
    sellerId: integer('seller_id')
      .notNull()
      .references(() => sellers.id),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').notNull(),
    updatedAt: integer('updated_at').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.portfolioId, t.customerId, t.productSubgroupId] }),
    index('portfolio_assignments_portfolio_subgroup_seller_idx').on(
      t.portfolioId,
      t.productSubgroupId,
      t.sellerId,
    ),
    index('portfolio_assignments_customer_id_idx').on(t.customerId),
    index('portfolio_assignments_seller_id_idx').on(t.sellerId),
    index('portfolio_assignments_product_subgroup_id_idx').on(t.productSubgroupId),
  ],
);

// Vínculos (E7): carteira x cliente x subgrupo x vendedor, com histórico. O encerrado nunca é apagado.
export const portfolioLinks = sqliteTable(
  'portfolio_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    portfolioId: integer('portfolio_id')
      .notNull()
      .references(() => portfolios.id),
    branchId: integer('branch_id')
      .notNull()
      .references(() => branches.id),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    productSubgroupId: integer('product_subgroup_id')
      .notNull()
      .references(() => productSubgroups.id),
    sellerId: integer('seller_id')
      .notNull()
      .references(() => sellers.id),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    validFrom: integer('valid_from').notNull(),
    validTo: integer('valid_to'),
    createdBy: text('created_by').notNull(),
    endedBy: text('ended_by'),
  },
  (t) => [
    // No máximo um vínculo ativo por (filial, cliente, subgrupo), entre todas as carteiras da filial.
    uniqueIndex('portfolio_links_active_cell_unique')
      .on(t.branchId, t.customerId, t.productSubgroupId)
      .where(sql`${t.active} = 1`),
    index('portfolio_links_portfolio_active_idx').on(t.portfolioId, t.active),
    index('portfolio_links_seller_id_idx').on(t.sellerId),
    // Histórico da carteira por id (sem TEMP B-TREE), com ou sem filtro de cliente.
    index('portfolio_links_portfolio_id_idx').on(t.portfolioId),
    index('portfolio_links_portfolio_customer_idx').on(t.portfolioId, t.customerId),
    // Encerramento por cliente (inativação/saída de filial no cadastro).
    index('portfolio_links_customer_id_idx').on(t.customerId),
  ],
);

// Outbox (E7): um evento por criação/encerramento de vínculo, na mesma transação. Lida por cursor (id).
export const portfolioLinkEvents = sqliteTable(
  'portfolio_link_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    linkId: integer('link_id')
      .notNull()
      .references(() => portfolioLinks.id),
    kind: text('kind', { enum: ['created', 'ended'] }).notNull(),
    portfolioId: integer('portfolio_id').notNull(),
    branchId: integer('branch_id').notNull(),
    customerId: integer('customer_id').notNull(),
    productSubgroupId: integer('product_subgroup_id').notNull(),
    sellerId: integer('seller_id').notNull(),
    occurredAt: integer('occurred_at').notNull(),
  },
  (t) => [
    index('portfolio_link_events_branch_id_idx').on(t.branchId, t.id),
    check('portfolio_link_events_kind_check', sql`${t.kind} in ('created', 'ended')`),
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
export type PortfolioType = typeof portfolioTypes.$inferSelect;
export type NewPortfolioType = typeof portfolioTypes.$inferInsert;
export type Portfolio = typeof portfolios.$inferSelect;
export type NewPortfolio = typeof portfolios.$inferInsert;
export type PortfolioRegion = typeof portfolioRegions.$inferSelect;
export type NewPortfolioRegion = typeof portfolioRegions.$inferInsert;
export type PortfolioRetailNetwork = typeof portfolioRetailNetworks.$inferSelect;
export type NewPortfolioRetailNetwork = typeof portfolioRetailNetworks.$inferInsert;
export type PortfolioEconomicGroup = typeof portfolioEconomicGroups.$inferSelect;
export type NewPortfolioEconomicGroup = typeof portfolioEconomicGroups.$inferInsert;
export type PortfolioSeller = typeof portfolioSellers.$inferSelect;
export type NewPortfolioSeller = typeof portfolioSellers.$inferInsert;
export type PortfolioCustomerOverride = typeof portfolioCustomerOverrides.$inferSelect;
export type NewPortfolioCustomerOverride = typeof portfolioCustomerOverrides.$inferInsert;
export type PortfolioAssignment = typeof portfolioAssignments.$inferSelect;
export type NewPortfolioAssignment = typeof portfolioAssignments.$inferInsert;
