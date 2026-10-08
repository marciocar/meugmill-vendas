# Contexto — carteira-e2-dados-mestres

- **Branch**: feature/carteira-e2-dados-mestres
- **Base**: main (`f7dc442`)
- **Task vinculada**: OG1-T3 · `2723266000000151010` (zoho) — E2, subtask de OG1-T1; 8 story points
- **Criada em**: 2026-10-08
- **Objetivo**: dar ao microserviço o cadastro próprio dos dados mestres (filiais, clientes, vendedores,
  subgrupos de produto, redes, grupos econômicos e localidades) que a carteira (E3) e o motor de
  elegibilidade (E4) vão consumir.

## Por que

O microserviço é a SSOT das carteiras e mantém CRUD próprio dos dados mestres (decisão de coleta,
2026-10-07). Sem esses cadastros, nem a carteira (E3) nem os filtros por região, rede e grupo econômico
(E4) têm sobre o que operar. A carga em lote por arquivo é do E10. O E2 entrega a API e as regras de
integridade.

## Decisões (maestro, 2026-10-08)

| Tema | Decisão |
|---|---|
| Região | Endereço no cliente: **UF e município pelo código IBGE** (tabela de municípios carregada por seed versionado) e **bairro como texto normalizado**. O filtro do E4 compara códigos, não nomes. |
| Cliente × filial | **Cliente global** (um CNPJ existe uma vez), com **vínculo N:N** às filiais que o atendem. O conflito entre carteiras do documento é "na mesma filial". |
| Permissão de escrita | **Só o perfil admin**, e só nas filiais do token. Leitura para qualquer autenticado, limitada às filiais do token. |
| Exclusão | **Inativar (soft delete)**: o registro fica `active = false` com data; preserva o histórico para o E7 e a auditoria. |

## Decisões herdadas (docs/business-context/02-product/features/carteira-de-clientes-hipoteses.md)

- Chaves: cliente por **CNPJ** (14 dígitos, com dígito verificador validado); vendedor, filial,
  subgrupo, rede e grupo econômico por **código interno do ERP**. **Sem CPF em lugar nenhum.**
- Claims do token: `sub`, `roles`, `branch_ids` (configuráveis desde o E1).
- Meta de volume para teste de carga: 50 mil clientes, 500 vendedores, 50 filiais.

## Defaults que assumo (marcar `[INFERIDO]` no código quando relevante)

- **Vendedor** guarda só `código` e `nome` (o nome é necessário para a tela), sem e-mail, telefone
  ou documento (minimização LGPD). Vínculo N:N com filiais, como o cliente.
- **Catálogos globais** (subgrupos, redes, grupos econômicos) não pertencem a filial; qualquer admin
  pode escrever neles. `[INFERIDO]`
- **Concorrência otimista**: cada registro tem `version`; a atualização exige a versão lida (header
  `If-Match`) e responde 409 se outra pessoa alterou antes.
- **Auditoria mínima**: `created_at`, `updated_at`, `created_by` e `updated_by` (o `sub` do token).
- **Unicidade**: códigos e CNPJ únicos mesmo entre registros inativos. Reativar é um endpoint próprio.

## Resultado esperado

- Migrations com as tabelas e o seed IBGE (UFs e municípios).
- API REST em `/v1` para cada cadastro: listar (paginação, busca, filtro `active`, escopo por
  filial), detalhar, criar, atualizar (`PATCH` com `If-Match`), inativar e reativar. Mais leitura de
  UFs e municípios.
- Autorização: 401 sem token, 403 para quem não é admin numa escrita ou fora das suas filiais.
- Documentação OpenAPI gerada da própria API, para o time do sistema principal.
- Testes de regra (CNPJ, normalização de bairro, unicidade, escopo, 403, 409) e do contrato HTTP.

## Fora do escopo

Carteiras e vínculos (E3 a E7), importação e exportação em arquivo (E10), telas (E9) e sincronização
automática com o ERP (só se o cliente pedir).

## Riscos

1. **Escopo de leitura por filial em lista grande:** precisa de índice no vínculo cliente × filial e
   paginação por cursor, para não degradar com 50 mil clientes.
2. **Seed IBGE:** o dado vem do serviço de localidades do IBGE. Versiono um snapshot datado no repo
   (sem depender de rede no boot) e registro a data e a fonte.
3. **Nome do vendedor é dado pessoal:** fica mínimo e não aparece em log (redação do E1).

## Como testar

Vitest com `buildApp` e banco `:memory:` (padrão do E1); um JWT de teste por perfil e filial. O smoke
do Compose ganha um fluxo de criar → ler → inativar de um cadastro.

## 📋 Phase-Subtask Mapping
- **Phase 1**: "Schema, migrations e seed IBGE" → Subtask ID: 2723266000000151010
- **Phase 2**: "Domínio: validação, autorização e repositórios" → Subtask ID: 2723266000000151010
- **Phase 3**: "API dos catálogos, filiais e localidades" → Subtask ID: 2723266000000151010
- **Phase 4**: "API de clientes e vendedores" → Subtask ID: 2723266000000151010
- **Phase 5**: "OpenAPI, smoke e documentação" → Subtask ID: 2723266000000151010

> O E2 não tem subtasks no Zoho; todas as fases apontam para a própria OG1-T3.
