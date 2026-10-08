/** Tipos das respostas da API v1 usadas pelas telas (subconjunto de `openapi-v1.json`). */

export interface Ref {
  id: number;
  code: string;
  name: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface Catalog extends Ref {
  active: boolean;
  version: number;
}

export interface Branch extends Catalog {
  municipalityCode: number;
}

export interface Seller extends Catalog {
  branches: (Ref & { active: boolean })[];
}

export interface State {
  ibgeCode: number;
  uf: string;
  name: string;
}

export interface Municipality {
  ibgeCode: number;
  name: string;
  stateCode: number;
  uf: string;
}

export type RegionLevel = 'state' | 'municipality' | 'neighborhood';

export interface Region {
  level: RegionLevel;
  stateCode: number;
  uf: string;
  municipalityCode?: number;
  municipalityName?: string;
  neighborhoodKey?: string;
  neighborhoodLabel?: string;
}

/** Região como o `PUT /filters` a recebe. */
export interface RegionInput {
  level: RegionLevel;
  stateCode: number;
  municipalityCode?: number;
  neighborhoodLabel?: string;
}

export interface Portfolio {
  id: number;
  name: string;
  description: string | null;
  branch: Ref;
  type: Ref;
  responsibleSub: string;
  status: 'draft' | 'active';
  active: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
  deactivatedAt: number | null;
  finalizedAt: number | null;
  filters: { regions: Region[]; retailNetworks: Ref[]; economicGroups: Ref[] };
  sellers: { seller: Ref; productSubgroup: Ref }[];
  overridesInclude?: number;
  overridesExclude?: number;
  conflictsBlocked?: number;
  conflictsLost?: number;
}

export interface PortfolioSummary {
  id: number;
  name: string;
  branch: Ref;
  type: Ref;
  responsibleSub: string;
  status: 'draft' | 'active';
  active: boolean;
  version: number;
  regionsCount: number;
  retailNetworksCount: number;
  economicGroupsCount: number;
  sellersCount: number;
}

export interface CustomerBrief {
  id: number;
  cnpj: string;
  legalName: string;
  tradeName?: string | null;
  stateCode?: number;
  municipalityCode?: number;
  municipalityName?: string | null;
  neighborhood?: string | null;
}

export type Resolution = 'assigned' | 'lost' | 'blocked';

export interface PreviewItem {
  customer: CustomerBrief;
  source: 'filter' | 'manual';
  matchedRegionLevel: RegionLevel | null;
  matchedBy: { region: boolean; retailNetwork: boolean; economicGroup: boolean };
  rank: number;
  resolution: Resolution;
  competitors: { portfolioId: number; name: string; rank: number }[];
}

export interface OverrideEntry {
  customer: CustomerBrief;
  effective: boolean;
}

export interface Overrides {
  include: OverrideEntry[];
  exclude: OverrideEntry[];
}

export type CellStatus = 'assigned' | 'unassigned' | 'stale';

export interface AssignmentCell {
  customer: CustomerBrief;
  productSubgroup: Ref;
  seller: Ref | null;
  status: CellStatus;
}

export interface AssignmentSummary {
  subgroups: {
    productSubgroup: Ref;
    sellers: { seller: Ref; count: number }[];
    unassigned: number;
    stale: number;
  }[];
  totals: { members: number; cells: number; assigned: number; unassigned: number; stale: number };
}

export interface DistributeResult {
  portfolio: Portfolio;
  distributed: Record<string, number>;
  skippedSubgroupIds: number[];
}

export interface FinalizeResult {
  portfolio: Portfolio;
  created: number;
  ended: number;
  kept: number;
  takenOver: number;
}

export interface Visibility {
  profiles: string[];
  mode: 'profiles' | 'legacy' | 'denied';
  seller: { id: number; code: string } | null;
  visibleCustomers: number;
}

export interface VisibleCustomer extends CustomerBrief {
  via: { productSubgroupId: number; portfolioId: number; profile: string }[];
}

export const LAYOUT_IDS = [
  'branches',
  'product-subgroups',
  'retail-networks',
  'economic-groups',
  'sellers',
  'customers',
  'portfolios',
  'links',
] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

export interface CsvColumn {
  name: string;
  type: string;
  required: boolean;
  readOnly?: boolean;
  description: string;
  example: string;
}

export interface CsvLayout {
  id: LayoutId;
  title: string;
  description: string;
  key: string[];
  columns: CsvColumn[];
}

export type ImportStatus =
  | 'validating'
  | 'validated'
  | 'invalid'
  | 'applying'
  | 'applied'
  | 'partially_applied'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'interrupted';

export interface ImportJob {
  id: number;
  layout: LayoutId;
  status: ImportStatus;
  createdAt: number;
  updatedAt: number;
  fileSha256: string;
  fileBytes: number;
  totalRows: number;
  processedRows: number;
  errorRows: number;
  counts: Record<string, number>;
  fileError: { message: string; line: number | null } | null;
  validatedAt: number | null;
  expiresAt: number | null;
  confirmedAt: number | null;
  finishedAt: number | null;
}

export type ImportLineStatus = 'valid' | 'invalid' | 'applied' | 'failed';

export interface ImportLine {
  line: number;
  status: ImportLineStatus;
  action: 'create' | 'update' | 'unchanged' | 'linked' | null;
  activation: 'deactivate' | 'reactivate' | null;
  errorCode: string | null;
  message: string | null;
  warning: string | null;
}
