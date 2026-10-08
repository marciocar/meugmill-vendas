# Arquitetura — carteira-e3-cadastro-carteira

> Decisões e defaults em [context.md](context.md). Base herdada do E2: camada `domain/` (services
> síncronos, `DomainError`, `toActor`, paginação, `writeTx` imediato), rotas `routes/v1/` com `crud.ts`
> e `http.ts` (auth em `onRequest`, `If-Match`/`ETag`, erros `{error}`), busca com colunas `*_key`,
> OpenAPI gerado e `openapi-v1.json` versionado.

## 1. Visão geral

**Antes:** cadastros mestres, mas nada que os agrupe.

**Depois:** a carteira, um agregado com quatro partes, uma por etapa do wizard:

```
Portfolio (rascunho | ativa*, ativo/inativo)
 ├─ informações: nome, descrição, filial, responsável (sub), tipo
 ├─ filtros:     regiões [UF | município | bairro]  +  redes[]  +  grupos econômicos[]
 ├─ vendedores:  pares (vendedor, subgrupo)
 └─ resumo:      GET do agregado completo
                                   * ativação ("finalizar") só no E7
```

O E4 lê os filtros para montar a prévia, e o E6 lê os pares vendedor × subgrupo para distribuir.

## 2. Modelo de dados (migration nova)

| Tabela | Colunas | Restrições |
|---|---|---|
| `portfolio_types` | catálogo: `id`, `code`, `name`, `name_key` + colunas comuns | `code` único |
| `portfolios` | `id`, `branch_id` → branches, `name`, `name_key`, `description?`, `responsible_sub`, `portfolio_type_id` → portfolio_types, `status` (`draft`\|`active`) + colunas comuns (`active`, `version`, auditoria) | único (`branch_id`, `name_key`); índices em `responsible_sub` e `portfolio_type_id` |
| `portfolio_regions` | `id`, `portfolio_id` (cascade), `level` (`state`\|`municipality`\|`neighborhood`), `state_code`, `municipality_code?`, `neighborhood_key?`, `neighborhood_label?` | CHECK de coerência por nível; único (`portfolio_id`, `level`, `state_code`, `municipality_code`, `neighborhood_key`) |
| `portfolio_retail_networks` | `portfolio_id`, `retail_network_id` | PK composta |
| `portfolio_economic_groups` | `portfolio_id`, `economic_group_id` | PK composta |
| `portfolio_sellers` | `portfolio_id`, `seller_id`, `product_subgroup_id` | PK composta; índices em `seller_id` e `product_subgroup_id` |

- **Nível da região:**
  - `state` usa só `state_code`.
  - `municipality` usa `state_code` + `municipality_code` (coerentes).
  - `neighborhood` usa os dois, mais `neighborhood_key` (normalizado com o `neighborhoodKey` do E2) e o
    `neighborhood_label` (texto original, para exibir).
- **Unicidade do nome:** é sobre a chave normalizada, então "Norte — Farmácias" e "NORTE - FARMACIAS"
  colidem. Vale também entre carteiras inativas.
- **Status × ativo:** `status` é o ciclo do wizard (`draft` → `active` no E7), e `active` é a
  inativação (soft delete). São eixos independentes.

## 3. Autorização

| Operação | Regra |
|---|---|
| Ler | Carteiras cuja filial está no token. Fora disso, 404. |
| Criar | `admin` com a filial no token. |
| Editar informações, filtros e vendedores | `admin` da filial **ou** o responsável (`responsible_sub === actor.sub`, e a filial no token). |
| Trocar filial ou responsável | Só `admin`. A nova filial também precisa estar no token. |
| Inativar e reativar | Só `admin` da filial. |

**Validações nas escritas:**
- tipo existente e ativo;
- regiões coerentes com o IBGE (município da UF; bairro exige município);
- redes e grupos existentes e ativos;
- vendedores com **vínculo ativo** com a filial da carteira;
- subgrupos ativos;
- trocar a filial falha (400) se algum vendedor do conjunto não tiver vínculo ativo com a filial nova.

A resposta do agregado não traz dado pessoal: o responsável sai só como `responsibleSub`, e os
vendedores como `{ id, code, name }`, como no E2.

## 4. Contrato HTTP

| Rota | Comportamento |
|---|---|
| `GET /v1/portfolio-types` (+ CRUD) | Catálogo, pela fábrica `registerCatalogRoutes` do E2 |
| `GET /v1/portfolios?q=&branchId=&status=&active=&responsibleSub=&cursor=&limit=` | Lista **resumida**: id, nome, filial, tipo, status, active, contagens de filtros e de vendedores |
| `POST /v1/portfolios` | Cria o **rascunho** com as informações. 201 + `ETag "1"`. 409 `conflict` se o nome já existir na filial. |
| `GET /v1/portfolios/{id}` | **Agregado completo** (o resumo): informações, filtros e vendedores, com `ETag` |
| `PATCH /v1/portfolios/{id}` | Informações, com `If-Match` |
| `PUT /v1/portfolios/{id}/filters` | Corpo `{ regions[], retailNetworkIds[], economicGroupIds[] }`. **Substitui** o conjunto, com `If-Match`. Devolve o agregado. |
| `PUT /v1/portfolios/{id}/sellers` | Corpo `{ assignments: [{ sellerId, productSubgroupId }] }`. **Substitui** o conjunto, com `If-Match`. Devolve o agregado. |
| `POST /v1/portfolios/{id}/deactivate` · `/reactivate` | Inativação, com `If-Match`, idempotente |

- Todas as escritas incrementam a `version` do agregado, para que uma etapa salva por uma pessoa não
  apague a de outra (409).
- `PUT` com conjunto vazio limpa a seção.
- Duplicata dentro do mesmo `PUT` dá 400.
- Erros e formatos seguem o E2: 400, 403, 404, 409, 428, sem eco do valor.

## 5. Estrutura de arquivos

```
apps/api/src/
  db/schema.ts                         # + tabelas do §2
  domain/portfolio-types/              # createPortfolioTypeService (catálogo genérico)
  domain/portfolios/
    schemas.ts                         # Create/Update/Filters/Sellers/Response/ListItem (TypeBox)
    service.ts                         # agregado: create, get, list, update, replaceFilters,
                                       #   replaceSellers, deactivate, reactivate
    authz.ts                           # canEdit(actor, portfolio), canChangeOwnership(...)
    validate.ts                        # regiões, referências, compatibilidade vendedor × filial
  routes/v1/portfolio-types.ts         # fábrica do catálogo
  routes/v1/portfolios.ts              # rotas do §4
apps/api/drizzle/0004_*.sql            # tabelas do E3
apps/api/test/domain/portfolios*.test.ts
apps/api/test/routes/portfolios.test.ts
scripts/smoke.sh                       # + rascunho → filtros → vendedores → resumo
docs/technical-context/api-carteiras.md
```

## 6. Padrões

- **Mantidos:**
  - services síncronos;
  - `writeTx` imediato, com o agregado e as tabelas filhas na mesma transação;
  - `If-Match` em toda escrita;
  - 404 fora do escopo;
  - busca com `name_key`;
  - OpenAPI gerado da API;
  - erros sem eco.
- **Introduzidos:**
  - **agregado com seções substituíveis** (`PUT` de conjunto), com a versão no agregado;
  - **autorização por dono** (o responsável) somada ao perfil;
  - **CHECK de coerência** de nível no banco, além da validação no service.

## 7. Trade-offs

| Decisão | Alternativa | Por que não |
|---|---|---|
| `PUT` substituindo o conjunto por seção | `POST`/`DELETE` item a item | O wizard salva a etapa inteira de uma vez. Item a item multiplica requisições e versões. |
| Versão única no agregado | Versão por seção | Simples e segura. O custo é um 409 quando duas pessoas editam seções diferentes ao mesmo tempo, o que é raro. |
| Região numa tabela com `level` | Três tabelas (UF, cidade, bairro) | Uma consulta só no E4, e o nível já vem pronto para a prioridade do E5. |
| Leitura para todos da filial | Restringir já por perfil | Depende de ligar o `sub` a um vendedor, que é do E8. |
| `status` separado de `active` | Um campo só | O rascunho pode ser inativado (abandonado), e uma carteira ativa também. São eixos diferentes. |

## 8. Fases

1. **Schema e migration**: tabelas do §2, CHECK e índices; testes de integridade.
2. **Domínio**: services de tipo e de carteira, autorização por dono, validações; testes sem HTTP.
3. **API**: rotas do §4 e catálogo de tipos; contrato HTTP com JWT de admin, responsável e leitor.
4. **OpenAPI, smoke, docs e revisão**: export do OpenAPI, smoke do fluxo do wizard,
   `api-carteiras.md`, inventário, e revisão com lacunas de teste em paralelo.
