# Arquitetura — carteira-e2-dados-mestres

> Decisões e defaults em [context.md](context.md). Base técnica herdada do E1: Fastify 5, TypeBox,
> SQLite + Drizzle (migrations em `apps/api/drizzle/`), auth JWT com `request.user: UserClaims`
> (`sub`, `roles`, `branchIds`), logs com redação e `buildApp()` testável.

## 1. Visão geral

**Antes:** a API só tem `/health`, `/ready` e `/v1/me`. O banco tem só a tabela técnica `service_meta`.

**Depois:**

```
 sistema principal / <gmill-carteira>
            │  JWT (sub, roles, branch_ids)
            ▼
 ┌─────────────────────── apps/api ────────────────────────┐
 │ routes/v1/*  ──►  domain/<cadastro>/service  ──►  repo  │──► SQLite
 │   (HTTP, schema TypeBox,     (regras, authz,     (Drizzle)│    (tabelas do E2
 │    If-Match, paginação)       unicidade, 409)            │     + seed IBGE)
 │                 domain/shared: cnpj, normalize, authz,   │
 │                 errors, pagination                       │
 └──────────────────────────────────────────────────────────┘
```

As rotas só traduzem HTTP. A regra fica no service, que é testável sem HTTP, e o acesso ao banco
fica no repositório. É a separação de que E3 a E7 vão precisar.

## 2. Modelo de dados (novas tabelas, snake_case)

| Tabela | Colunas principais | Restrições |
|---|---|---|
| `states` | `ibge_code` (PK int), `uf` (char 2), `name` | `uf` único |
| `municipalities` | `ibge_code` (PK int, 7 dígitos), `name`, `state_code` → states | índice (`state_code`, `name`) |
| `branches` (filiais) | `id`, `code`, `name`, `municipality_code` → municipalities | `code` único |
| `product_subgroups` | `id`, `code`, `name` | `code` único |
| `retail_networks` (redes) | `id`, `code`, `name` | `code` único |
| `economic_groups` | `id`, `code`, `name` | `code` único |
| `sellers` (vendedores) | `id`, `code`, `name` | `code` único |
| `seller_branches` | `seller_id`, `branch_id` | PK composta; índice em `branch_id` |
| `customers` | `id`, `cnpj` (14 dígitos), `legal_name`, `trade_name?`, `state_code`, `municipality_code`, `neighborhood`, `neighborhood_key`, `retail_network_id?`, `economic_group_id?` | `cnpj` único; índices em (`municipality_code`, `neighborhood_key`), `retail_network_id` e `economic_group_id` (são os filtros do E4) |
| `customer_branches` | `customer_id`, `branch_id` | PK composta; índice em `branch_id` |

**Colunas comuns a todo cadastro:** `active` (bool, default true), `deactivated_at`, `version` (int,
começa em 1), `created_at`, `updated_at`, `created_by` e `updated_by` (o `sub` do token).

- **Ids:** inteiros autoincrementais internos. A paginação usa cursor por `id`.
- **`neighborhood_key`:** o bairro em maiúsculas, sem acento e com espaços colapsados
  ("Jardim  Camburi" → "JARDIM CAMBURI"). É o que o E4 compara. O texto original fica para exibição.
- **Coerência:** o `state_code` do cliente precisa bater com a UF do município. É regra do service e
  é testada.
- **Seed IBGE:** um snapshot datado do serviço de localidades do IBGE (27 UFs e cerca de 5.570
  municípios) vira uma migration SQL versionada (`drizzle-kit generate --custom`). O boot não depende
  de rede e o dado é idêntico em todo ambiente. Atualizar significa gerar uma migration nova.

## 3. Autorização

As `branch_ids` do token são **códigos de filial** (`branches.code`). `[INFERIDO]`

| Operação | Regra |
|---|---|
| Ler cadastros com filial (filiais, clientes, vendedores) | Só o que está ligado a pelo menos uma filial do token. Uma filial é visível se o código dela está no token. |
| Ler catálogos globais e localidades | Qualquer autenticado |
| Escrever qualquer cadastro | Perfil `admin` (403 caso contrário) |
| Escrever cadastro com filial | Toda filial que o admin **adiciona ou remove** do vínculo precisa estar no token. Editar os dados de um cliente ou vendedor exige que pelo menos uma filial dele esteja no token. |
| Criar filial | O código da filial nova precisa estar no token do admin |

**Cliente que já existe em outra filial:** um `POST /v1/customers` com CNPJ já cadastrado responde
409 `customer_exists`. O admin então liga o cliente à sua filial com
`POST /v1/customers/by-cnpj/{cnpj}/branches` (`{ branchId }`). Para o vendedor, o equivalente é
`POST /v1/sellers/by-code/{code}/branches` (409 `seller_exists`).

> **Corrigido em 2026-10-08, após a revisão.** A redação original dizia que o link "expõe só que o CNPJ
> existe". Era falso: o link devolvia o cliente inteiro, e o admin que o fazia passava a poder inativar
> o cliente para todas as filiais (o `active` era global) e a reescrever os dados compartilhados.
> Decisão do maestro, aplicada a clientes e vendedores:
> - O link responde só `{ id, version }` + `ETag`.
> - **Ativo por vínculo** (`customer_branches.active` e `seller_branches.active`): inativar ou reativar
>   age só nas filiais do token. O estado global só muda quando o admin cobre **todas** as filiais do
>   registro.
> - **Dados compartilhados** (razão social, nome fantasia, endereço, rede e grupo; nome do vendedor):
>   alterar exige admin de todas as filiais do registro. Senão, 403.

## 4. Contrato HTTP

Para cada recurso — `branches`, `product-subgroups`, `retail-networks`, `economic-groups`, `sellers`
e `customers`:

| Método e rota | Comportamento |
|---|---|
| `GET /v1/{recurso}?q=&active=&cursor=&limit=` | Lista paginada `{ items, nextCursor }`. `limit` vai de 1 a 200, default 50. `q` busca por código ou nome (no cliente, por CNPJ, razão social ou nome fantasia). Respeita o escopo. |
| `GET /v1/{recurso}/{id}` | 200, ou 404 (também quando o registro está fora do escopo, para não revelar que existe) |
| `POST /v1/{recurso}` | 201 com o registro e `ETag: "<version>"`. 409 se o código ou CNPJ já existir. |
| `PATCH /v1/{recurso}/{id}` | Exige `If-Match: "<version>"`: sem o header, 428; versão velha, 409 `version_conflict`. 200 com o registro novo e o `ETag` novo. |
| `POST /v1/{recurso}/{id}/deactivate` · `/reactivate` | Também com `If-Match`. Idempotente quando o registro já está no estado pedido. |
| `GET /v1/geo/states` · `GET /v1/geo/municipalities?uf=&q=` | Leitura das localidades IBGE |

Clientes e vendedores recebem `branchIds` (ids internos) no corpo. As respostas trazem as filiais
como `{ id, code, name }`.

**Erros (formato do E1):**
- `{ error: 'validation_error', message }` — 400
- `forbidden` — 403
- `not_found` — 404
- `conflict`, `customer_exists`, `version_conflict` — 409
- `precondition_required` — 428

Nenhuma resposta de erro ecoa o valor enviado.

**OpenAPI:** `@fastify/swagger` gera `GET /v1/openapi.json` a partir dos schemas TypeBox que as rotas
já usam. É só o JSON, sem a interface visual, para não aumentar a superfície. O time da GMill gera o
cliente deles a partir dele.

## 5. Estrutura de arquivos

```
apps/api/src/
  db/schema.ts                         # tabelas acima (Drizzle)
  domain/shared/
    cnpj.ts                            # normaliza e valida dígito verificador
    normalize.ts                       # neighborhood_key, trim/colapso
    authz.ts                           # requireAdmin, branch scope (códigos do token → ids)
    errors.ts                          # DomainError → HTTP (404/403/409/428)
    pagination.ts                      # cursor por id
  domain/catalog/                      # serviço genérico p/ code+name (subgrupos, redes, grupos)
  domain/branches/  domain/sellers/  domain/customers/  domain/geo/
  routes/v1/
    catalog.ts                         # fábrica de rotas para os 3 catálogos
    branches.ts  sellers.ts  customers.ts  geo.ts  openapi.ts
apps/api/drizzle/
  0001_*.sql                           # tabelas do E2
  0002_seed_ibge.sql                   # seed (custom), com fonte e data no cabeçalho
apps/api/scripts/
  build-ibge-seed.ts                   # gera 0002 a partir do JSON do IBGE (roda à mão, não no boot)
apps/api/test/
  domain/*.test.ts                     # regras sem HTTP
  routes/*.test.ts                     # contrato HTTP com JWT por perfil e filial
scripts/smoke.sh                       # + criar → ler → inativar um subgrupo
docs/technical-context/api-dados-mestres.md
```

## 6. Padrões mantidos ou introduzidos

- **Mantidos do E1:** `buildApp()` testável, falha fechada, minimização LGPD, erros sem eco e logs
  sem dado pessoal. O nome do vendedor nunca vai para o log.
- **Introduzidos:**
  - camada `domain/` (service + repositório);
  - concorrência otimista com `ETag`/`If-Match`;
  - soft delete com `version`;
  - paginação por cursor;
  - fábrica de rotas para catálogos `code + name`, para não triplicar código;
  - transação explícita nas escritas que tocam vínculos N:N.

## 7. Trade-offs

| Decisão | Alternativa | Por que não agora |
|---|---|---|
| Id inteiro interno | UUID | Cursor simples e índice compacto. Não é exposto a terceiros como identificador de negócio (para isso existem código e CNPJ). |
| Seed IBGE como migration versionada | Buscar na API do IBGE no boot | Boot sem rede e dado reprodutível. O custo é regenerar quando o IBGE mudar algo, o que é raro. |
| `If-Match` obrigatório no PATCH | Última escrita vence | Dois admins editando o mesmo cliente perderiam alteração sem aviso. |
| 404 para fora do escopo | 403 | Não revela a existência de cadastro de outra filial. Exceção declarada: `customer_exists` no POST. |
| Só o JSON do OpenAPI | Swagger UI | Menos superfície e dependências. A UI pode entrar depois em dev. |
| Fábrica para os 3 catálogos | Uma rota por catálogo | Os três são idênticos (`code + name`). Clientes e vendedores têm rotas próprias. |

## 8. Fases e paralelismo

1. **Schema, migrations e seed IBGE**, sequencial, base de tudo.
2. **Domínio:** `shared` (cnpj, normalize, authz, errors, pagination) e os services. Sequencial.
3. **API dos catálogos, filiais e localidades** e 4. **API de clientes e vendedores**, **em paralelo**
   (arquivos separados). O registro das rotas no `app.ts` fica com o orquestrador, para os dois
   agentes não editarem o mesmo arquivo.
5. **OpenAPI, smoke e documentação**, depois de 3 e 4.
