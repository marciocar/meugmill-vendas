---
updated: 2026-10-08
source: apps/api/src/domain/distribution/, apps/api/src/routes/v1/distribution.ts, apps/api/test/routes/distribution.test.ts, apps/api/test/domain/distribution-volume.test.ts, scripts/smoke.sh, .claude/sessions/carteira-e6-distribuicao/context.md, .claude/sessions/carteira-e6-distribuicao/architecture.md
---

# Distribuição dos clientes entre vendedores (v1)

Escopo: `apps/api` (MeuGmill Vendas, carteira de clientes), E6. Os clientes `assigned` da carteira
(ver [`api-conflitos.md`](./api-conflitos.md)) são divididos entre os vendedores de cada subgrupo, à mão
ou automaticamente. As atribuições são **rascunho**: transformá-las em vínculo (com histórico e outbox) é
trabalho do **E7**. Contrato completo: [`openapi-v1.json`](./openapi-v1.json).

As decisões marcadas **[auto]** foram tomadas pelo orquestrador em 2026-10-08
(`.claude/sessions/carteira-e6-distribuicao/context.md`).

## Regra de negócio

Documento: "O responsável pode escolher um vendedor para cada cliente ou usar a distribuição automática.
A distribuição automática divide os clientes entre os vendedores disponíveis em cada subgrupo. Um mesmo
cliente pode ser atendido por vendedores diferentes em subgrupos diferentes. Dentro do mesmo subgrupo,
porém, só pode haver um vendedor responsável pelo cliente."

## Unidade

**[auto]** Atribuição = (carteira, cliente, subgrupo) -> vendedor. A chave primária
(`portfolio_id`, `customer_id`, `product_subgroup_id`) garante **um vendedor por cliente por subgrupo**;
subgrupos diferentes podem ter vendedores diferentes. Os subgrupos da carteira são os dos pares
vendedor x subgrupo do E3 (`portfolio_sellers`).

## Grade e status

A grade é `membros efetivos (assigned do E5)` x `subgrupos da carteira`. Cada célula tem um status:

| Status       | Significado                                                                          |
| ------------ | ------------------------------------------------------------------------------------ |
| `assigned`   | Há atribuição válida.                                                                |
| `unassigned` | O cliente é membro efetivo e o subgrupo é da carteira, mas não há atribuição válida. |
| `stale`      | Há atribuição gravada, mas ela perdeu a validade (o vendedor aparece no item).       |

## Validade

**[auto]** Uma atribuição vale quando: o cliente é membro efetivo (`assigned` do E5); o par
(vendedor, subgrupo) está na carteira; o vendedor está ativo e tem vínculo ativo com a filial. Quando
perde a validade (cliente perdeu a disputa, par removido, vendedor inativado) ela fica gravada como
`stale` e é ignorada, no mesmo padrão dos ajustes do E4: nada some sem rastro. O `distribute` sobrescreve
as `stale`.

## Rotas

Todas sob `/v1/portfolios/{id}`. Ler segue a leitura da carteira; escrever segue a edição do E3.

| Método e rota              | O que faz                                                |
| -------------------------- | -------------------------------------------------------- |
| `GET /assignments`         | Células paginadas por (cliente, subgrupo).               |
| `GET /assignments/summary` | Contagens por subgrupo e totais.                         |
| `PUT /assignments`         | Edição manual parcial (`set`/`clear`), com `If-Match`.   |
| `POST /distribute`         | Distribuição automática das células sem vendedor válido. |

### Listagem

Query: `productSubgroupId`, `sellerId`, `status` (`assigned|unassigned|stale`), `cursor`, `limit`
(mesma paginação da prévia; máx. 200). Valor inválido responde `400`. Resposta:
`{ items: [{ customer: {id, cnpj, legalName}, productSubgroup: {id, code, name}, seller: {id, code, name} | null, status }], nextCursor, total }`.
`total` conta todas as células que casam os filtros. `seller` é `null` em `unassigned` e vem preenchido
em `stale`.

### Resumo

`{ subgroups: [{ productSubgroup, sellers: [{ seller, count }], unassigned, stale }], totals: { members, cells, assigned, unassigned, stale } }`.
`sellers` traz todos os vendedores do subgrupo na carteira (contagem 0 inclusive), por código. Atribuições
gravadas em subgrupo que saiu da carteira entram só em `totals.stale`.

### Manual (set/clear)

**[auto]** `PUT /assignments` é um lote parcial e atômico:
`{ "set": [{ customerId, productSubgroupId, sellerId }], "clear": [{ customerId, productSubgroupId }] }`.
Até **5.000 itens** (set + clear) por chamada; a mesma célula não pode repetir. Cada `set` é validado
(cliente efetivo, par da carteira, vendedor utilizável) e a chamada inteira falha com `400` se um item
for inválido. Resposta: o agregado da carteira (`200`) com o novo `ETag`.

### Automático

`POST /distribute` com `{ "productSubgroupIds"?: number[] }` (corpo ausente ou `{}` = todos os
subgrupos). **[auto]** A estratégia é a **balanceada determinística**:

- preenche **só** as células sem vendedor válido (`unassigned` e `stale`); as válidas são **preservadas**
  e entram na contagem de cada vendedor;
- em cada subgrupo, o cliente (em ordem de id) vai para o vendedor com **menos** clientes; o empate é
  decidido pelo **código do vendedor**;
- subgrupo sem vendedor utilizável é **reportado** em `skippedSubgroupIds`, sem erro;
- a estratégia fica isolada (`domain/distribution/strategies/`) para trocar por rodízio ou faturamento.

Resposta `200`:

```json
{
  "portfolio": { "id": 10, "version": 5 },
  "distributed": { "<productSubgroupId>": 120 },
  "skippedSubgroupIds": [7],
  "finalCounts": { "<productSubgroupId>": [{ "sellerId": 3, "count": 60 }, { "sellerId": 4, "count": 60 }] }
}
```

- `portfolio` é o agregado completo da carteira.
- `distributed` conta as atribuições gravadas nesta execução, por id de subgrupo.
- `finalCounts` traz a contagem **final** de células válidas por vendedor: as preservadas mais as gravadas
  agora. Inclui todos os vendedores utilizáveis do subgrupo, inclusive com contagem 0.
- **O equilíbrio vale só sobre o que falta.** Como as atribuições válidas são preservadas, um vendedor que
  já tinha muitos clientes continua com eles, e a diferença final entre vendedores pode passar de 1.
  `[auto]` A redistribuição completa, que move clientes já atribuídos, não faz parte do E6.
- O `ETag` é a versão do agregado (`portfolio.version`). **Quando não há nada a preencher, nada é gravado
  e a versão não muda.** A resposta repete o mesmo `ETag`.

Erros do `set` indicam o item com problema pelo índice, sem repetir o valor enviado. Exemplo:
`set[3]: Cliente não é membro efetivo da carteira`. Cliente inexistente, de outra filial ou com vínculo
inativo recebem a mesma mensagem.

**Para o E7:** `loadAssignmentGrid(conn, portfolioId)` (`domain/distribution/grid.ts`) devolve a grade
inteira sem paginação, para finalizar sem percorrer páginas. Ela refaz a disputa do E5 uma vez e deve ser
chamada dentro da transação de escrita.

## Permissões e versão

**[auto]** Escrever (manual ou automático): admin ou responsável da carteira, carteira não inativa
(`409 portfolio_inactive`), `If-Match` obrigatório. Sem `If-Match`: `428`; versão velha: `409
version_conflict`; cabeçalho malformado: `400`; leitor: `403`; carteira fora do escopo ou inexistente:
`404`; sem token: `401`. Cada escrita incrementa a versão da carteira. Os `400` de validação não ecoam
os ids enviados.

## Desempenho

Medido em `apps/api/test/domain/distribution-volume.test.ts` (50 mil membros x 3 subgrupos):

| Operação                      | Tempo medido | Teto  |
| ----------------------------- | ------------ | ----- |
| `distribute` (150 mil linhas) | ~0,7 s       | 5 s   |
| Página da listagem            | até ~0,35 s  | 1,5 s |
| `summary`                     | até ~0,43 s  | 1,5 s |

A escrita em massa é síncrona (uma transação, um INSERT em lote por `json_each`) e bloqueia o laço de
eventos durante esse tempo.

## Fora do escopo

Virar vínculo (finalizar a carteira, gravar histórico e outbox) é o **E7**. A tela é o E9.
