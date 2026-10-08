---
updated: 2026-10-08
source: apps/api/src/domain/links/, apps/api/src/routes/v1/links.ts, apps/api/src/routes/v1/http.ts, apps/api/test/routes/portfolio-links.test.ts, apps/api/test/domain/links.test.ts, scripts/smoke.sh, .claude/sessions/carteira-e7-vinculos/context.md, .claude/sessions/carteira-e7-vinculos/architecture.md
---

# Vínculos da carteira: finalizar, histórico e outbox (v1)

Escopo: `apps/api` (MeuGmill Vendas, carteira de clientes), E7. Finalizar a carteira transforma as
atribuições válidas do E6 (ver [`api-distribuicao.md`](./api-distribuicao.md)) em **vínculos** carteira x
cliente x subgrupo x vendedor, com histórico, e registra os eventos numa **outbox** para o sistema
principal. Contrato completo: [`openapi-v1.json`](./openapi-v1.json).

As decisões marcadas **[auto]** foram tomadas pelo orquestrador em 2026-10-08
(`.claude/sessions/carteira-e7-vinculos/context.md`).

## Regra de negócio

Documento: "Ao finalizar, o MeuGmill grava os vínculos entre carteira, cliente, vendedor e subgrupo. Ao
editar uma carteira, o sistema compara as atribuições atuais com a lista revisada: vínculos removidos da
lista deixam de ficar ativos, e novos vínculos são criados."

## Rotas

Leitura segue a leitura da carteira (escopo de filial); finalizar segue a edição do E3.

| Método e rota                           | O que faz                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POST /v1/portfolios/{id}/finalize`     | Finaliza (com `If-Match`; corpo vazio aceito). Devolve `{ portfolio, created, ended, kept, takenOver }` e `ETag`. |
| `GET /v1/portfolios/{id}/links`         | Vínculos **ativos**: filtros `productSubgroupId`, `sellerId`; `cursor`, `limit`; `total`.                         |
| `GET /v1/portfolios/{id}/links/history` | Todos os vínculos (ativos e encerrados): filtro `customerId`; `cursor`, `limit`.                                  |
| `GET /v1/link-events`                   | Outbox: `branchId`, `after`, `limit` (1 a 1000, padrão 100).                                                      |

O agregado da carteira ganha `finalizedAt` (epoch ms da última finalização que gravou vínculos; `null` se
nunca finalizada). Quem finalizou (`finalized_by`) fica só no banco e **não** é exposto (minimização).

## Finalizar

Numa transação imediata, na ordem: escopo (404), permissão (403), `If-Match` (428/400), carteira não
inativa (409 `portfolio_inactive`) e versão (409 `version_conflict`). Depois:

0. **Filial inativa:** finalizar carteira de filial inativa é recusado com 400 `validation_error` e
   mensagem fixa, pois os vínculos nasceriam numa filial desativada.

1. **Conflitos pendentes:** com clientes `blocked` (E5), 409 `portfolio_has_conflicts`.
2. **Completude:** toda célula da grade (membro efetivo x subgrupo) precisa de vendedor válido; senão,
   409 `portfolio_incomplete`. Atribuição fora da grade (cliente que saiu, subgrupo removido) não conta.
3. **Diff** contra os vínculos ativos da carteira, por (cliente, subgrupo): mesmo vendedor, mantém
   (`kept`); vendedor diferente, encerra o antigo e cria o novo; saiu da grade, encerra (`ended`); entrou,
   cria (`created`). Trocar de vendedor conta 1 em `created` e 1 em `ended`.
4. **Unicidade entre carteiras** (abaixo): se outra carteira da filial ainda mantém vínculo ativo numa
   célula que esta vai criar, esse vínculo é encerrado (tomada, `takenOver`).
5. Grava vínculos e eventos, muda `status` para `active`, registra `finalizedAt` e incrementa a versão.

Sem nenhuma mudança e com a carteira já `active`, nada é gravado: resultado `created=0, ended=0`, a
versão e o `ETag` não mudam (idempotente).

## Unicidade e tomada de vínculo (`takenOver`)

**[auto]** Índice único **parcial** (`branch_id`, `customer_id`, `product_subgroup_id`) onde `active = 1`:
um cliente tem no máximo um vendedor ativo por subgrupo na filial, mesmo entre carteiras. O vínculo
encerrado fica no histórico e não conta.

Se outra carteira Q da filial ainda mantém vínculo ativo numa célula que a carteira P vai criar, é porque
Q foi finalizada quando ainda vencia a disputa do cliente (regra de posto do E5, ver
[`api-distribuicao.md`](./api-distribuicao.md)) e P passou a vencer. Como a regra do E5 já define **quem
é dono do cliente**, a finalização de P **encerra** os vínculos de Q nessas células, na mesma transação, e
o total vai em `takenOver`. Não há mais recusa nem re-finalização manual de Q.

- Os vínculos tomados ganham `valid_to`/`ended_by` e um evento `ended` (carteira Q) é gravado **antes** dos
  eventos `created` de P.
- A carteira Q muda de versão (e de `ETag`), pois seus vínculos mudaram; ela segue `active`.
- Sem disputa, `takenOver = 0` (fluxo normal).

**Caso fail-closed:** se a célula está ocupada por vínculo de outra carteira que **não** perde a disputa
(estado inconsistente, raro), nada é gravado e a resposta é 409 `link_conflict` com
`detail.portfolioIds` (carteiras envolvidas).

## Histórico

**[auto]** Tabela `portfolio_links` com `active`, `valid_from`, `valid_to`, `created_by` e `ended_by`. O
vínculo encerrado **nunca é apagado** (auditoria e LGPD: quem atendia quem, e quando). O histórico lista
todos por id; `validTo` é `null` enquanto o vínculo está ativo.

## Inativação, transferência e cadastros encerram os vínculos

**[auto]** Inativar uma carteira ativa, ou transferi-la de filial, encerra todos os seus vínculos, com
eventos `ended`, na mesma transação, e a carteira volta a `status: 'draft'`. Reativar também deixa a
carteira em `draft` e **não** recria vínculos: é preciso finalizar de novo. `GET /links` volta com
`total = 0` e o histórico mostra todos encerrados.

Mudanças de cadastro do E2 também encerram vínculos ativos, com eventos `ended` e **sem mudar a versão da
carteira**: inativar vendedor, cliente ou filial, e desfazer o vínculo de vendedor ou cliente com a filial
(ver [`api-dados-mestres.md`](./api-dados-mestres.md)).

## Outbox e consumo pelo sistema principal

**[auto]** `portfolio_link_events` (id crescente, `kind` = `created` ou `ended`, vínculo, carteira, filial,
cliente, subgrupo, vendedor, instante) é gravada na **mesma transação** dos vínculos: não há vínculo sem
evento nem evento sem vínculo. A API devolve `{ items, nextAfter, hasMore }`, escopada pelas filiais do
token (`branchId` fora do escopo ou inexistente é 404; sem `branchId`, vale a união das filiais do token).

Consumo, sem fila:

1. Comece com `after=0` (ou o último `nextAfter` guardado).
2. Leia `GET /v1/link-events?branchId=<id>&after=<after>&limit=1000`.
3. Processe os itens em ordem; guarde `nextAfter` como novo `after` (null = página vazia, mantenha o atual).
4. Repita enquanto `hasMore` for `true`; depois, volte a consultar periodicamente.

Entrega **pelo menos uma vez**: o consumidor deve ser idempotente pelo `id` do evento. Os itens trazem
`customer.cnpj` e códigos de filial, subgrupo e vendedor (sem razão social).

**Dívida registrada:** a outbox cresce sem limite; não há política de retenção/expurgo. Definir (por
exemplo, apagar eventos já consumidos além de N dias) antes de produção.

## Detalhe dos 409

Os erros de regra levam `detail` (só números e ids de carteiras, nunca dados de cliente nem valor enviado):

| Código                    | `detail`                      | Significado                                     |
| ------------------------- | ----------------------------- | ----------------------------------------------- |
| `portfolio_incomplete`    | `{ unassigned, stale }`       | Células da grade sem vendedor válido.           |
| `portfolio_has_conflicts` | `{ blocked }`                 | Clientes bloqueados por empate de posto (E5).   |
| `link_conflict`           | `{ portfolioIds: [id, ...] }` | Fail-closed raro: célula ocupada indevidamente. |

Os demais erros seguem sem `detail`: `{ "error": "<código>" }`.

## Índices do histórico

Além do índice único parcial, `portfolio_links` tem índices em `portfolio_id`, (`portfolio_id`,
`customer_id`) e `customer_id` (migração `0010_e7_links_indexes`), para o histórico por carteira e por
cliente e para o encerramento por cadastro.

## Desempenho medido

Escrita em massa síncrona, medida no `test:perf` (domínio):

| Cenário                                            | Tempo   |
| -------------------------------------------------- | ------- |
| 1ª finalização: 150 mil vínculos + 150 mil eventos | ~1,4 s  |
| Re-finalização com 1% de mudanças                  | ~0,95 s |

Metas do contexto: <= 5 s na 1ª finalização e <= 2 s na re-finalização com poucas mudanças.

## Fora do escopo

Visibilidade por perfil (E8, usa os vínculos ativos), tela (E9) e arquivo (E10).
