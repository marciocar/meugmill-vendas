# Arquitetura — carteira-e4-elegibilidade

> Decisões em [context.md](context.md) (todas **[auto]**). Base: E2 (clientes com `municipality_code`,
> `neighborhood_key`, `retail_network_id`, `economic_group_id` e `customer_branches.active`) e E3
> (`portfolios`, `portfolio_regions` por nível, `portfolio_retail_networks`,
> `portfolio_economic_groups`, versão única do agregado e `portfolio_inactive`).

## 1. Visão geral

```
 filtros da carteira (E3) ─┐
                           ├─► motor de elegibilidade (SQL único) ─► candidatos por filtro
 cadastros (E2) ───────────┘                                            │
 ajustes manuais (E4) ── include ─────────────────────────────────────► ∪
                      └─ exclude ─────────────────────────────────────► −
                                                                        ▼
                                                     prévia paginada (nível casado → E5)
```

## 2. Modelo de dados (migration nova)

| Tabela | Colunas | Restrições |
|---|---|---|
| `portfolio_customer_overrides` | `portfolio_id` (cascade), `customer_id` → customers, `kind` (`include`\|`exclude`), `created_at`, `created_by` | PK (`portfolio_id`, `customer_id`), que garante a exclusão mútua por cliente; CHECK em `kind`; índice em `customer_id` |

Índices de apoio ao motor, a confirmar pelo `EXPLAIN`:
- os de `customers` já existentes no E2, por município + bairro, rede e grupo;
- o `customer_branches(branch_id, customer_id)`;
- `customers(state_code)`, se o plano pedir.

## 3. O motor

Uma função pura de consulta, `eligibleCustomersQuery(portfolio)`, que monta **um** `SELECT` sobre
`customers c`:

```
WHERE c.active = 1
  AND EXISTS (customer_branches cb: cb.customer_id = c.id AND cb.branch_id = :branch AND cb.active = 1)
  AND (sem regiões OU EXISTS(região casa: state | municipality | neighborhood))
  AND (sem redes   OU c.retail_network_id IN (redes da carteira))
  AND (sem grupos  OU c.economic_group_id IN (grupos da carteira))
  AND (a carteira tem ao menos um critério)   -- sem filtro → nenhum candidato por filtro
```

- **Nível casado:** uma expressão `CASE` que devolve o maior nível entre as entradas de região que
  casam (`neighborhood` > `municipality` > `state`). É `NULL` quando a carteira não tem região.
- **Critérios casados:** booleanos `byRegion`, `byRetailNetwork` e `byEconomicGroup`. São usados para
  exibir e para o E5.
- **Prévia:** (candidatos por filtro − exclusões) ∪ (inclusões válidas), ordenada por `customer.id`,
  com paginação por cursor e busca `q` (razão social, nome fantasia e CNPJ, com as chaves do E2) e
  filtro `source`. O total sai de um `COUNT` sobre a mesma expressão.
- **Inclusão válida:** cliente ativo com vínculo ativo na filial. Uma inclusão que perdeu a validade
  some da prévia e aparece como `effective: false` na listagem de ajustes. Uma exclusão de cliente que
  já não casa também aparece como `effective: false`.

## 4. Contrato HTTP

| Rota | Comportamento |
|---|---|
| `GET /v1/portfolios/{id}/preview?q=&source=filter\|manual&cursor=&limit=` | `{ items, nextCursor, total }`. Cada item traz `customer { id, cnpj, legalName, tradeName, stateCode, municipalityCode, municipalityName, neighborhood }`, `source`, `matchedRegionLevel`, `matchedBy { region, retailNetwork, economicGroup }`. Só a leitura da carteira (404 fora do escopo). |
| `GET /v1/portfolios/{id}/overrides` | `{ include: [{ customer, effective }], exclude: [{ customer, effective }] }` |
| `PUT /v1/portfolios/{id}/overrides` | `{ include: number[], exclude: number[] }`. Substitui o conjunto, com `If-Match`, permissão de edição e carteira ativa. Um id nas duas listas ou repetido dá 400. Uma inclusão inválida (cliente inativo, sem vínculo ativo na filial, inexistente ou fora do escopo) dá 400. Uma exclusão de cliente fora do escopo dá 400. Até 5.000 ids. Devolve o agregado com o `ETag` novo. |

O agregado do E3 (`GET /v1/portfolios/{id}`) ganha as contagens `overridesInclude` e
`overridesExclude`.

## 5. Arquivos

```
apps/api/src/db/schema.ts                     # + portfolio_customer_overrides
apps/api/drizzle/0005_*.sql
apps/api/src/domain/eligibility/
  query.ts                                    # motor: SQL único (Drizzle sql/qb), nível casado
  service.ts                                  # preview(actor, id, params), overrides get/replace
  schemas.ts
apps/api/src/routes/v1/portfolios.ts          # + rotas de preview e overrides (ou arquivo próprio)
apps/api/test/domain/eligibility*.test.ts     # regras + volume sintético (50k) com tempo medido
apps/api/test/routes/eligibility.test.ts
scripts/smoke.sh                              # + cliente que casa, cliente fora, inclusão e exclusão
docs/technical-context/api-elegibilidade.md
```

## 6. Trade-offs

| Decisão | Alternativa | Por que não |
|---|---|---|
| Prévia sob demanda | Tabela materializada | Envelhece quando cliente, vínculo ou filtro mudam, e exige invalidação. |
| SQL único | Filtrar em memória | 50 mil clientes por chamada não cabe em memória com paginação. |
| Ajuste por PUT de conjunto | Endpoints item a item | Mantém o padrão do E3, e o wizard salva a etapa. |
| PK (carteira, cliente) para os ajustes | Duas tabelas | A exclusão mútua fica garantida pelo banco. |

## 7. Fases

1. **Schema e motor** (`query.ts`) com testes de regra e de volume sintético.
2. **Domínio da prévia e dos ajustes** (`service.ts`).
3. **API** e contagens no agregado.
4. **OpenAPI, smoke, docs e revisão** em paralelo.
