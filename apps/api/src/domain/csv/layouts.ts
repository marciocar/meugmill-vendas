import { fileError, type CsvDocument } from './codec.js';

/**
 * Layouts de CSV (E10). [INFERIDO] É o default proposto em 2026-10-07 (UTF-8 com BOM, `;`, cabeçalho em
 * pt-BR) e ainda não foi validado com a GMill: os nomes de coluna ficam todos aqui.
 */
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

export type ColumnType = 'text' | 'code' | 'cnpj' | 'integer' | 'boolean' | 'list';

export interface ColumnSpec {
  name: string;
  type: ColumnType;
  /** Obrigatória no cabeçalho e com valor em toda linha. */
  required: boolean;
  /** Só sai na exportação; na importação é aceita e ignorada. */
  readOnly?: boolean;
  description: string;
  example: string;
}

export interface LayoutSpec {
  id: LayoutId;
  title: string;
  description: string;
  /** Colunas que formam a chave natural (upsert). */
  key: string[];
  columns: ColumnSpec[];
}

const ACTIVE: ColumnSpec = {
  name: 'ativo',
  type: 'boolean',
  required: false,
  description: '`S` ou `N`. Vazio ou ausente vale `S`. `N` inativa nas filiais do usuário.',
  example: 'S',
};

const catalog = (id: LayoutId, title: string, what: string): LayoutSpec => ({
  id,
  title,
  description: `${what}. O código é a identidade e não muda; só o nome é atualizado.`,
  key: ['codigo'],
  columns: [
    {
      name: 'codigo',
      type: 'code',
      required: true,
      description: 'Código do ERP, sem espaços.',
      example: 'SG01',
    },
    {
      name: 'nome',
      type: 'text',
      required: true,
      description: 'Nome (até 120 caracteres).',
      example: 'Genéricos',
    },
    ACTIVE,
  ],
});

export const LAYOUTS: Record<LayoutId, LayoutSpec> = {
  branches: {
    id: 'branches',
    title: 'Filiais',
    description: 'Filiais. Criar uma filial exige o código dela no token do usuário.',
    key: ['codigo'],
    columns: [
      {
        name: 'codigo',
        type: 'code',
        required: true,
        description: 'Código da filial no ERP.',
        example: 'F01',
      },
      {
        name: 'nome',
        type: 'text',
        required: true,
        description: 'Nome (até 120 caracteres).',
        example: 'Serra',
      },
      {
        name: 'municipio_ibge',
        type: 'integer',
        required: true,
        description: 'Código IBGE do município (7 dígitos).',
        example: '3205002',
      },
      ACTIVE,
    ],
  },
  'product-subgroups': catalog('product-subgroups', 'Subgrupos de produto', 'Subgrupos de produto'),
  'retail-networks': catalog('retail-networks', 'Redes', 'Redes de farmácias'),
  'economic-groups': catalog('economic-groups', 'Grupos econômicos', 'Grupos econômicos'),
  sellers: {
    id: 'sellers',
    title: 'Vendedores',
    description:
      'Vendedores. Só código, nome e filiais (minimização). A ligação com o login (`userSub`) não entra no ' +
      'arquivo: é feita pela API.',
    key: ['codigo'],
    columns: [
      {
        name: 'codigo',
        type: 'code',
        required: true,
        description: 'Código do vendedor no ERP.',
        example: 'V001',
      },
      {
        name: 'nome',
        type: 'text',
        required: true,
        description: 'Nome (até 120 caracteres).',
        example: 'Ana Souza',
      },
      {
        name: 'filiais',
        type: 'list',
        required: true,
        description:
          'Códigos das filiais, separados por `|`. É o conjunto desejado entre as filiais do usuário; as ' +
          'outras filiais do vendedor não mudam.',
        example: 'F01|F02',
      },
      ACTIVE,
    ],
  },
  customers: {
    id: 'customers',
    title: 'Clientes',
    description:
      'Clientes (farmácias), pela chave CNPJ. Um CNPJ que já existe fora das filiais do usuário só ganha o ' +
      'vínculo com as filiais do arquivo: os dados dele não mudam.',
    key: ['cnpj'],
    columns: [
      {
        name: 'cnpj',
        type: 'cnpj',
        required: true,
        description: 'CNPJ com ou sem máscara (numérico ou alfanumérico). Nunca CPF.',
        example: '11.222.333/0001-81',
      },
      {
        name: 'razao_social',
        type: 'text',
        required: true,
        description: 'Até 200 caracteres.',
        example: 'Farmácia Exemplo Ltda',
      },
      {
        name: 'nome_fantasia',
        type: 'text',
        required: false,
        description: 'Opcional; vazio limpa.',
        example: 'Farmácia Exemplo',
      },
      {
        name: 'uf',
        type: 'text',
        required: false,
        readOnly: true,
        description: 'Só na exportação, para leitura. A UF vem do município.',
        example: 'ES',
      },
      {
        name: 'municipio_ibge',
        type: 'integer',
        required: true,
        description: 'Código IBGE do município (7 dígitos).',
        example: '3205002',
      },
      {
        name: 'bairro',
        type: 'text',
        required: true,
        description: 'Até 100 caracteres.',
        example: 'Jardim Camburi',
      },
      {
        name: 'rede_codigo',
        type: 'code',
        required: false,
        description: 'Código da rede; vazio tira a rede.',
        example: 'R01',
      },
      {
        name: 'grupo_economico_codigo',
        type: 'code',
        required: false,
        description: 'Código do grupo econômico; vazio tira o grupo.',
        example: 'G01',
      },
      {
        name: 'filiais',
        type: 'list',
        required: true,
        description:
          'Códigos das filiais, separados por `|` (conjunto desejado entre as filiais do usuário).',
        example: 'F01',
      },
      ACTIVE,
    ],
  },
  portfolios: {
    id: 'portfolios',
    title: 'Carteiras',
    description:
      'Cabeçalho e filtros das carteiras, pela chave filial + nome. Cada lista substitui a seção inteira da ' +
      'carteira. A carteira nova nasce em rascunho; a finalização vem pelo arquivo de vínculos ou pela API.',
    key: ['filial_codigo', 'nome'],
    columns: [
      {
        name: 'filial_codigo',
        type: 'code',
        required: true,
        description: 'Código da filial da carteira.',
        example: 'F01',
      },
      {
        name: 'nome',
        type: 'text',
        required: true,
        description: 'Nome, único na filial (até 120).',
        example: 'Serra Norte',
      },
      {
        name: 'tipo_codigo',
        type: 'code',
        required: true,
        description: 'Código do tipo de carteira.',
        example: 'GEO',
      },
      {
        name: 'responsavel_sub',
        type: 'text',
        required: true,
        description: 'Identificador (`sub`) do login do responsável.',
        example: 'gest-01',
      },
      {
        name: 'descricao',
        type: 'text',
        required: false,
        description: 'Opcional (até 1.000); vazio limpa.',
        example: '',
      },
      {
        name: 'regioes',
        type: 'list',
        required: false,
        description: 'Regiões separadas por `|`: `UF`, `UF/município IBGE` ou `UF/município IBGE/bairro`.',
        example: 'ES/3205002/Jardim Camburi|ES/3201308',
      },
      {
        name: 'redes',
        type: 'list',
        required: false,
        description: 'Códigos das redes, separados por `|`.',
        example: 'R01',
      },
      {
        name: 'grupos_economicos',
        type: 'list',
        required: false,
        description: 'Códigos dos grupos econômicos, separados por `|`.',
        example: '',
      },
      {
        name: 'vendedores',
        type: 'list',
        required: false,
        description: 'Pares `subgrupo:vendedor` (códigos), separados por `|`.',
        example: 'SG01:V001|SG01:V002',
      },
      {
        name: 'situacao',
        type: 'text',
        required: false,
        readOnly: true,
        description: 'Só na exportação: `rascunho` ou `ativa`.',
        example: 'ativa',
      },
      ACTIVE,
    ],
  },
  links: {
    id: 'links',
    title: 'Vínculos',
    description:
      'Vínculos cliente × subgrupo × vendedor. O arquivo é o conjunto COMPLETO de cada carteira que aparece ' +
      'nele: a importação troca as atribuições e finaliza a carteira, passando pelas regras de prévia, ' +
      'conflitos e grade completa. Cada carteira entra inteira ou não entra.',
    key: ['filial_codigo', 'carteira', 'cnpj', 'subgrupo_codigo'],
    columns: [
      {
        name: 'filial_codigo',
        type: 'code',
        required: true,
        description: 'Código da filial da carteira.',
        example: 'F01',
      },
      {
        name: 'carteira',
        type: 'text',
        required: true,
        description: 'Nome da carteira.',
        example: 'Serra Norte',
      },
      {
        name: 'cnpj',
        type: 'cnpj',
        required: true,
        description: 'CNPJ do cliente.',
        example: '11.222.333/0001-81',
      },
      {
        name: 'subgrupo_codigo',
        type: 'code',
        required: true,
        description: 'Código do subgrupo.',
        example: 'SG01',
      },
      {
        name: 'vendedor_codigo',
        type: 'code',
        required: true,
        description: 'Código do vendedor.',
        example: 'V001',
      },
    ],
  },
};

export function isLayoutId(value: string): value is LayoutId {
  return (LAYOUT_IDS as readonly string[]).includes(value);
}

/** Linha já ligada ao cabeçalho: valor por nome de coluna, com trim. Coluna ausente vale `''`. */
export interface Row {
  line: number;
  /** A linha não tem o mesmo número de campos do cabeçalho (erro da linha, não do arquivo). */
  malformed: boolean;
  get(column: string): string;
  has(column: string): boolean;
}

/**
 * Confere o cabeçalho contra o layout (ordem livre) e devolve as linhas. Coluna desconhecida, repetida
 * ou obrigatória ausente invalida o arquivo. A linha com número de campos diferente do cabeçalho sai
 * marcada (`malformed`) e vira erro dela no relatório.
 */
export function bindRows(layout: LayoutSpec, doc: CsvDocument): Row[] {
  const known = new Map(layout.columns.map((c) => [c.name, c]));
  const index = new Map<string, number>();
  doc.header.forEach((name, i) => {
    if (!known.has(name)) throw fileError('Coluna desconhecida no cabeçalho', 1);
    if (index.has(name)) throw fileError('Coluna repetida no cabeçalho', 1);
    index.set(name, i);
  });
  for (const c of layout.columns) {
    if (c.required && !index.has(c.name)) throw fileError('Coluna obrigatória ausente no cabeçalho', 1);
  }
  const width = doc.header.length;
  return doc.records.map((r) => new BoundRow(r.line, r.values, index, r.values.length !== width));
}

/** Linha ligada ao cabeçalho (métodos no protótipo: barato para 100 mil linhas). */
class BoundRow implements Row {
  constructor(
    readonly line: number,
    private readonly values: string[],
    private readonly index: ReadonlyMap<string, number>,
    readonly malformed: boolean,
  ) {}

  get(column: string): string {
    const i = this.index.get(column);
    return i === undefined || this.malformed ? '' : (this.values[i] ?? '').trim();
  }

  has(column: string): boolean {
    return this.index.has(column);
  }
}

/** Cabeçalho da exportação: todas as colunas, na ordem do layout. */
export function headerOf(layout: LayoutSpec): string[] {
  return layout.columns.map((c) => c.name);
}
