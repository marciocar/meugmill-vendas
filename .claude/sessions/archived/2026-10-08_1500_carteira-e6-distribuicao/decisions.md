# Arquitetura — carteira-e6-distribuicao

> Decisões em [context.md](context.md).

## Modelo

`portfolio_assignments`: `portfolio_id` (cascade), `customer_id`, `product_subgroup_id`, `seller_id` → sellers, `created_at/by`, `updated_at/by`; PK (`portfolio_id`, `customer_id`, `product_subgroup_id`); índices (`portfolio_id`, `product_subgroup_id`, `seller_id`) e (`customer_id`).

## Status de uma célula (cliente × subgrupo)

- `assigned`: há atribuição válida.
- `unassigned`: o cliente é membro efetivo e o subgrupo é da carteira, mas não há atribuição válida.
- `stale`: há atribuição gravada, mas ela perdeu a validade.

A grade de células = `effectiveMembers(P)` × subgrupos distintos de `portfolio_sellers(P)`.

## Distribuição automática

É uma estratégia isolada (`domain/distribution/strategies/balanced.ts`). Por subgrupo:

1. Conta as atribuições válidas por vendedor.
2. Percorre as células `unassigned` em ordem de cliente.
3. Atribui ao vendedor de menor contagem, com empate pelo código.

É uma passada O(n log k) em memória sobre os ids, seguida de **um** INSERT em lote, numa transação.

## Contrato

- `GET /v1/portfolios/{id}/assignments?productSubgroupId=&sellerId=&status=&cursor=&limit=`
- `GET /v1/portfolios/{id}/assignments/summary`
- `PUT /v1/portfolios/{id}/assignments` (`set`/`clear`)
- `POST /v1/portfolios/{id}/distribute`

As duas escritas usam `If-Match` e devolvem o agregado com `ETag`.

## Fases

1. Schema, domínio, estratégia, testes de regra e volume.
2. API, OpenAPI, smoke, docs e revisão.
