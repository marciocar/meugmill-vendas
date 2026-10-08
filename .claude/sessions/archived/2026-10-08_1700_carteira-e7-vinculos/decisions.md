# Arquitetura — carteira-e7-vinculos

> Decisões em [context.md](context.md).

## Modelo

- **`portfolio_links`:** `id`, `portfolio_id`, `branch_id`, `customer_id`, `product_subgroup_id`, `seller_id`, `active`, `valid_from`, `valid_to`, `created_by`, `ended_by`. Índice único **parcial** (`branch_id`, `customer_id`, `product_subgroup_id`) `WHERE active = 1`; índices (`portfolio_id`, `active`) e (`seller_id`).
- **`portfolio_link_events`:** `id` (cursor), `link_id`, `kind`, `portfolio_id`, `branch_id`, `customer_id`, `product_subgroup_id`, `seller_id`, `occurred_at`. Índice (`branch_id`, `id`).
- **`portfolios`:** ganha `finalized_at` e `finalized_by`.

## Finalizar, numa transação imediata

1. Ordem do E3: escopo, permissão, `If-Match` e `portfolio_inactive`.
2. Lê `loadAssignmentGrid` e recusa com `portfolio_has_conflicts` se houver `blocked`, ou com `portfolio_incomplete` se houver `unassigned` ou `stale` na grade.
3. Calcula o diff contra os vínculos ativos de P.
4. Confere se outras carteiras da filial têm vínculo ativo nas células novas. Se tiverem, recusa com `link_conflict`.
5. Encerra e cria os vínculos em lote via `json_each`, grava os eventos, muda `status` para `active`, registra `finalized_*` e incrementa a versão.

## Inativar

Encerra os vínculos ativos de P e grava os eventos, na mesma transação da inativação do E3.

## Contrato

- `POST /v1/portfolios/{id}/finalize` devolve `{ portfolio, created, ended, kept }`, com `ETag`.
- `GET /v1/portfolios/{id}/links` e `GET /v1/portfolios/{id}/links/history`.
- `GET /v1/link-events?branchId=&after=&limit=`.

## Fases

1. Domínio e schema, com testes de regra e volume.
2. API, OpenAPI, smoke, docs e revisão.
