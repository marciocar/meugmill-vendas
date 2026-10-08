---
reviewed_diff_sha256: n/a (diff grande; revisão sobre main...cba92a4, correções em a8c3134 e 4e8f410)
findings_total: 9
findings_real: 9
tokens: 470000
duration_min: 25
verdict: REPROVADO_E_CURADO
elenxo: sim
nota: >
  Passada pré-PR com dois agentes independentes, ambos só leitura: @branch-code-reviewer (lente
  autorização, integridade, LGPD, SQL e contrato) e @branch-test-planner (lente cobertura). A revisão
  achou um defeito ALTO de modelo de autorização. A correção dependia de decisão de negócio, e o
  maestro escolheu "ativo por vínculo + dados compartilhados protegidos" para clientes e vendedores.
  Os nove achados foram curados neste PR, e as 10 lacunas de teste viraram testes. Os tokens somam os
  dois revisores e as duas frentes de correção.
---

# Resíduo — `feature/carteira-e2-dados-mestres`

## Revisão do diff (@branch-code-reviewer)

| # | sev. | achado | destino |
|---|---|---|---|
| 1 | ALTA | O link por CNPJ devolvia o cliente inteiro, e qualquer admin podia inativá-lo para todas as filiais ou reescrever razão social e endereço (que o E4 compara). | Curado (`4e8f410`): link só com `{ id, version }`; ativo por vínculo; dados compartilhados exigem todas as filiais. A arquitetura, que afirmava o contrário, foi corrigida. |
| 2 | MÉDIA | O log do 500 copiava `message`, `query` e `params` de `DrizzleQueryError`, ou seja, CNPJ e nome em texto claro. | Curado (`a8c3134`): só name, code, cause e frames. Testado com erro real de SQL e com `DrizzleQueryError` construído. |
| 3 | MÉDIA | O código de vendedor revelava existência fora do escopo (409), e não havia como vincular. | Curado (`4e8f410`): `seller_exists` declarado e `POST /v1/sellers/by-code/{code}/branches`. |
| 4 | BAIXA | Localidades validavam antes de autenticar (400 em vez de 401). | Curado (`a8c3134`): `onRequest`. |
| 5 | BAIXA | `safePath` vazava o sufixo do CNPJ quando a barra vinha sem codificar. | Curado (`a8c3134`): mascara tudo após `/by-cnpj/` e `/by-code/`. |
| 6 | BAIXA | O OpenAPI não documentava o `ETag`, que é necessário para o `If-Match`. | Curado (`4e8f410`): header `ETag` nas respostas 200/201. |
| 7 | BAIXA | A busca `q` era sensível a acento e caixa ("sao" não achava "SÃO"). | Curado (`4e8f410`): colunas `*_key` com backfill. |
| 8 | BAIXA | O índice só por `branch_id` não ajudava a listagem com escopo na meta de 50 mil clientes. | Curado (`4e8f410`): índices `(branch_id, customer_id)` e `(branch_id, seller_id)`; o `EXPLAIN QUERY PLAN` usa o índice. |
| 9 | BAIXA | O escape de `_` no LIKE não tinha teste. | Curado (`a8c3134`). |

## Cobertura (@branch-test-planner)

As 10 lacunas viraram testes (de 241 para 298): cursor e `q` fora do escopo, filiais mistas no PATCH
(cliente e vendedor), deactivate/reactivate fora do escopo, efeito de inativar filial, rede ou grupo,
`%` e `_` em cliente e vendedor, dois escritores com a mesma versão, link incrementando a versão, CNPJ
alfanumérico ponta a ponta, link sem vazar filial oculta e rollback do PATCH.

**Ficou para E3+, por decisão declarada:** validação das respostas contra o OpenAPI com Ajv, corrida
real entre processos, carga com volume e claims de produção do IdP.

## Ponto que estava em aberto (adotado)

O revisor da correção propôs trocar a escalada implícita ("se o admin cobre todas as filiais,
inativar vira global") por rotas explícitas. O maestro adotou a proposta em `d2d5acd`:
`deactivate`/`reactivate` agem só nos vínculos, e `deactivate-global`/`reactivate-global` exigem
todas as filiais do registro.
