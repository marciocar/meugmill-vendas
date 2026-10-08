# Arquitetura — carteira-e8-visibilidade

> Decisões em [context.md](context.md).

## Modelo

`sellers.user_sub` é text, opcional, com índice único parcial `WHERE user_sub IS NOT NULL`.

## Perfis efetivos do ator

`effectiveProfiles(actor)` devolve um subconjunto de { vendedor, gestor, admin, supervisao }, a partir de `roles`, que fica em constantes. Se nenhum perfil for reconhecido, o modo é `legacy`.

## Clientes visíveis (`visibleCustomersSql(actor)`)

Uma CTE com a união, sempre restrita às filiais do token:

- admin ou supervisão: clientes com vínculo ativo em `customer_branches` com as filiais do token;
- gestor: clientes de `portfolio_links` ativos de carteiras com `responsible_sub = sub`;
- vendedor: clientes de `portfolio_links` ativos com `seller_id` do vendedor cujo `user_sub = sub`.

A CTE é usada por `/me/customers`, `/visibility/check` e pela restrição das leituras do E2 e do E3.

## Restrição das leituras

- **Clientes (E2), list e get:** se o ator não é admin, supervisão nem legacy, aplica a interseção com `visibleCustomers`.
- **Carteiras (E3), list e get:** o gestor vê as carteiras em que é responsável; o vendedor vê as carteiras em que o seu vendedor está em `portfolio_sellers` ou tem vínculo ativo.
- **Prévia, ajustes, atribuições e vínculos:** exigem admin, supervisão ou o responsável. Os demais recebem 404, como fora do escopo.

## Contrato

- `GET /v1/me/visibility`
- `GET /v1/me/customers?q=&productSubgroupId=&cursor=&limit=`
- `POST /v1/visibility/check` com `{ customerIds }` devolve `{ visible: number[] }`

## Fases

1. Domínio e schema, restrições, testes de regra e volume.
2. API, OpenAPI, smoke, docs e revisão.
