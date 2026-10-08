---
updated: 2026-10-08
source: apps/api/src/domain/conflicts/, apps/api/src/domain/eligibility/query.ts, apps/api/src/routes/v1/eligibility.ts, apps/api/test/routes/conflicts.test.ts, scripts/smoke.sh, .claude/sessions/carteira-e5-conflitos/context.md, .claude/sessions/carteira-e5-conflitos/architecture.md
---

# Conflitos entre carteiras da filial (v1)

Escopo: `apps/api` (MeuGmill Vendas, carteira de clientes), E5. Quando duas carteiras da mesma filial
alcançam o mesmo cliente, vence a correspondência mais específica; em empate, o cliente fica bloqueado
nas duas prévias para revisão. Os conflitos aparecem na prévia de cada carteira
(`GET /v1/portfolios/{id}/preview`, ver [`api-elegibilidade.md`](./api-elegibilidade.md)). Contrato
completo: [`openapi-v1.json`](./openapi-v1.json).

As decisões marcadas **[auto]** foram tomadas pelo orquestrador em 2026-10-08
(`.claude/sessions/carteira-e5-conflitos/context.md`).

## Regra de negócio

Documento: "Se duas carteiras da mesma filial alcançarem o mesmo cliente, o sistema considera a
correspondência mais específica: 1. Grupo econômico; 2. Rede; 3. Região por bairro; 4. Região por
cidade; 5. Região por estado. [...] Se duas carteiras tiverem a mesma prioridade para um cliente, esse
cliente fica bloqueado nas duas prévias para que a equipe revise o conflito."

## Posto (rank)

| Posto | Correspondência                          |
| ----- | ---------------------------------------- |
| 6     | Inclusão manual **[auto]**               |
| 5     | Grupo econômico                          |
| 4     | Rede                                     |
| 3     | Região por bairro                        |
| 2     | Região por município                     |
| 1     | Região por UF                            |

- **[auto]** O posto de uma carteira para um cliente é o **maior** entre os critérios que **casaram** o
  cliente nela. Uma carteira com região e rede que casa os dois vale pela rede (4).
- **[auto]** Inclusão manual vale 6, acima de qualquer filtro. Duas carteiras que incluem o mesmo cliente
  manualmente empatam e o bloqueiam.
- **[auto]** Exclusão manual: o cliente **não concorre** naquela carteira.
- O posto usa a mesma regra de casamento da prévia (E4): cliente ativo, vínculo ativo com a filial, OU
  dentro do critério e E entre critérios.

## Quem concorre

**[auto]** As carteiras **não inativas** da mesma filial, em **rascunho ou ativas**. Um rascunho em
revisão também disputa o cliente (a disputa aparece justamente na revisão). Carteira inativa não disputa:
inativar uma carteira libera os clientes bloqueados por ela.

## Resolução

Para um cliente com posto `r` na carteira P, e as demais carteiras da filial em que ele tem posto:

| `resolution` | Condição                                                              |
| ------------ | --------------------------------------------------------------------- |
| `assigned`   | Sem concorrente, ou `r` maior que o posto de todos os concorrentes    |
| `lost`       | Algum concorrente tem posto maior que `r`                             |
| `blocked`    | `r` é o maior e algum concorrente empata nele                         |

## Campos

Item da prévia:

- `rank`: posto da carteira para o cliente (1 a 6).
- `resolution`: `assigned`, `lost` ou `blocked`.
- `competitors`: `[{ portfolioId, name, rank }]`, as carteiras concorrentes. Só aparecem as carteiras da
  mesma filial do token (o leitor só enxerga a filial da carteira, que já é a do escopo dele).

Consulta: `resolution=assigned|lost|blocked` filtra os itens e o `total` respeita o filtro. Valor
inválido (inclusive vazio ou em caixa alta) responde `400`.

Agregado da carteira (`GET /v1/portfolios/{id}`):

- `conflictsBlocked`: clientes da carteira em empate de posto (bloqueados).
- `conflictsLost`: clientes da carteira em que outra da filial tem posto maior.

As contagens cobrem todos os clientes com posto na carteira, não só a página.

## Membros efetivos (entrada do E6)

`effectiveMembers(db, portfolioId)` (`domain/conflicts/members.ts`) itera, em ordem crescente de id, os
clientes `assigned` da carteira, com `customerId`, `rank`, `source` e `matchedRegionLevel`.
**[auto]** Só `assigned` segue para a distribuição (E6) e o vínculo (E7): `lost` pertence a outra carteira
e `blocked` exige revisão. A disputa é resolvida uma vez no início da iteração e nada fica em cache.
`conflictTotals(db, portfolioId)` devolve `{ blocked, lost }`.

## Desempenho

Medido com volume sintético de **50 mil clientes x 20 carteiras** na filial: **0,4 a 0,8 s** para a
prévia com resolução. A primeira versão levou **6,5 s**; o ganho veio de restringir o cálculo aos
clientes da filial e do índice `customers_state_code_idx`. Meta: 50 mil clientes com 20 carteiras; o
custo cresce com o número de carteiras da filial. Sem materialização persistente (exigiria nova decisão).

## Fora do escopo

Distribuição (E6), finalização e vínculos (E7). Painel de conflitos da filial: E9 (hoje a revisão é pela
prévia de cada carteira).

## Verificação

Testes de rota em `apps/api/test/routes/conflicts.test.ts` (bairro x cidade, empate, filtro, inativa,
escopo, 400) e `scripts/smoke.sh` (bairro único por execução, para não depender de carteiras de
execuções anteriores; as carteiras do teste são inativadas ao final).
