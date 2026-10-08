---
updated: 2026-10-08
source: apps/api/src/routes/v1/eligibility.ts, apps/api/src/domain/eligibility/, apps/api/src/domain/portfolios/, scripts/smoke.sh, .claude/sessions/carteira-e4-elegibilidade/context.md, .claude/sessions/carteira-e4-elegibilidade/architecture.md
---

# API de elegibilidade da carteira (v1)

Escopo: `apps/api` (MeuGmill Vendas, carteira de clientes), etapa 5 do wizard ("Clientes", E4). Este
documento resume o contrato; o contrato completo e gerado do código está em
[`openapi-v1.json`](./openapi-v1.json). Convenções comuns (JWT, paginação por cursor, erros sem eco, `ETag`)
vêm de [`api-dados-mestres.md`](./api-dados-mestres.md); o agregado, a versão e as permissões vêm de
[`api-carteiras.md`](./api-carteiras.md).

As decisões marcadas **[auto]** foram tomadas pelo orquestrador, com autorização do maestro em 2026-10-08,
e estão declaradas em `.claude/sessions/carteira-e4-elegibilidade/context.md`.

## O que é a prévia

`GET /v1/portfolios/{id}/preview` devolve a lista de clientes que a carteira alcança hoje, cruzando os
filtros (E3) com os cadastros (E2) e os ajustes manuais.

- **[auto] Calculada sob demanda, não materializada.** Nada da prévia é gravado. O que persiste são só os
  **ajustes manuais**. Os cadastros mudam, e uma prévia gravada envelheceria; a regra fica num lugar só.
- A gravação dos vínculos cliente x vendedor só acontece no **E7** (finalizar).
- Conflitos entre carteiras da filial (E5) são resolvidos na própria prévia: cada item traz `rank`,
  `resolution` e `competitors` (ver [`api-conflitos.md`](./api-conflitos.md)).

## Regra de elegibilidade

Um cliente entra na prévia por **filtro** quando:

1. o cliente está **ativo**;
2. tem **vínculo ativo** com a filial da carteira; e
3. casa os filtros da carteira: **OU dentro** de cada critério (alguma região, ou alguma rede, ou algum
   grupo econômico) e **E entre** os critérios preenchidos (decisão do E3).

Regras adicionais:

- **[auto] Carteira sem filtro: a prévia mostra só as inclusões manuais.** Coerente com o `[INFERIDO]` do E3.
- **Inclusão manual** adiciona um cliente que não casa os filtros. Ele precisa estar ativo e ter vínculo
  ativo com a filial.
- **Exclusão manual** remove da prévia um cliente que casa os filtros.
- Cada item traz `source`: `filter` (casou pelos filtros) ou `manual` (incluído à mão). O parâmetro
  `source` da consulta filtra por essa origem.

## Nível de região casado (para o E5)

Uma região casa se bater com **qualquer** entrada: UF (`state_code`), município (`municipality_code`) ou
bairro (município + chave normalizada do bairro, a mesma do E3). Cada item expõe
`matchedRegionLevel`: o nível **mais específico** que casou (`neighborhood` > `municipality` > `state`),
ou `null` quando nenhuma região casou (cliente que veio só por rede ou grupo) **e sempre `null` na
inclusão manual** (`source: manual`), mesmo que a região tenha casado: quem não casou o filtro inteiro não
ganha prioridade por região. `matchedBy` continua informativo e indica quais critérios casaram (`region`,
`retailNetwork`, `economicGroup`). O E5 usa esse nível para a prioridade bairro > cidade > estado.

## Campos de conflito (E5)

Cada item traz também `rank` (posto da carteira para o cliente: 1 UF, 2 município, 3 bairro, 4 rede,
5 grupo econômico, 6 inclusão manual), `resolution` (`assigned`, `lost` ou `blocked`) e `competitors`
(`[{ portfolioId, name, rank }]`, carteiras não inativas da mesma filial em que o cliente também tem
posto). As contagens `conflictsBlocked` e `conflictsLost` do agregado vêm só com `GET /v1/portfolios/{id}?include=conflicts`. Regras e desempenho em
[`api-conflitos.md`](./api-conflitos.md).

## Ajustes manuais

- `GET /v1/portfolios/{id}/overrides` lista `{ include[], exclude[] }`; cada entrada traz o cliente e
  `effective`.
- `PUT /v1/portfolios/{id}/overrides` **substitui o conjunto inteiro**: `{ "include": [customerId],
"exclude": [customerId] }`. Vazio limpa. Máximo de 5000 ajustes somados (inclusões + exclusões).
- **[auto] Inclusão e exclusão são mutuamente exclusivas por cliente.** Um mesmo id nas duas listas
  responde `400 validation_error`.
- `effective` mostra se o ajuste ainda tem efeito:
  - inclusão: `true` se o cliente está ativo e com vínculo ativo na filial;
  - exclusão: `true` se o cliente **casaria pelos filtros hoje**.
    Um ajuste que deixou de ter efeito continua gravado, mas a prévia o ignora e a lista o marca
    `effective: false`.
- A inclusão é validada na escrita (cliente ativo, vínculo ativo na filial). Depois disso, os cadastros
  podem mudar, e é para isso que serve `effective`.
- **Ajustes só de clientes com vínculo (ativo ou inativo) com a filial da carteira**, em inclusões e
  exclusões; a exclusão aceita vínculo inativo, a inclusão exige vínculo ativo. O escopo do ator (filiais
  do token) não basta: um admin de SER+CAR não grava ajuste de cliente só de CAR numa carteira de SER.
- **Troca de filial recusada com ajustes incompatíveis.** O `PATCH` do E3 que muda a filial responde
  `400 validation_error` (e não troca nada) se algum cliente ajustado, ainda vinculado à filial atual,
  não tem vínculo com a filial nova, na mesma linha da regra dos vendedores incompatíveis.
- **[auto] Ajustes órfãos.** Ajuste órfão é o de um cliente que deixou de ter vínculo (ativo ou inativo)
  com a filial da carteira. Surge quando `PATCH /customers/{id}` com `branchIds` remove o vínculo, pois
  essa operação não olha ajustes. O órfão fica gravado, mas não tem efeito, **não aparece** em
  `GET /overrides` (que lista só clientes vinculados à filial da carteira, sem sinal de que algo foi
  omitido) e **não entra** em `overridesInclude`/`overridesExclude` (que contam só ajustes de clientes
  vinculados à filial atual). Um `PUT /overrides` o apaga (substitui o conjunto). A troca de filial o
  **descarta** na mesma transação, antes de validar os demais ajustes; se a troca for recusada (400), a
  transação inteira é desfeita, inclusive esse descarte, e a versão não muda. A troca bem-sucedida
  incrementa a versão uma vez.
- **[auto]** Incluir um cliente que já casa o filtro é aceito: ele aparece como `source: filter` (não como
  `manual`) e conta em `overridesInclude` (total de ajustes de clientes vinculados à filial).

## Permissões e versão

Iguais ao E3 ([`api-carteiras.md`](./api-carteiras.md)).

| Operação               | Regra                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| Ler prévia e ajustes   | Qualquer autenticado com a filial da carteira em `branch_ids`     |
| Gravar ajustes (`PUT`) | `admin` da filial **ou** o responsável (`responsibleSub` = `sub`) |

- O `PUT` exige `If-Match` e usa a **versão única do agregado**: gravar ajustes incrementa a versão, e a
  resposta é a carteira completa com `ETag` novo.
- Ordem dos erros no `PUT`: 404 (escopo), 403 (permissão), 428 (sem `If-Match`), 409 `portfolio_inactive`,
  409 `version_conflict` e, por fim, 400 (validação de negócio).
- **Carteira inativa não é editável**: `PUT /overrides` responde `409 portfolio_inactive`. A leitura segue
  permitida.
- Carteira fora do escopo do token responde `404 not_found`, igual a inexistente.

## Escopo e privacidade

- **Cliente fora da filial da carteira = `400 validation_error` sem revelar existência.** Um id
  inexistente ou sem vínculo com a filial da carteira recebe a mesma mensagem genérica ("Cliente inválido ou fora do
  escopo"), sem eco do valor.
- A prévia devolve **só dado de empresa** do cliente (`id`, `cnpj`, `legalName`, `tradeName`, UF,
  município, nome do município e bairro). Nada de pessoa física ou de paciente (LGPD).

## Parâmetros da prévia

| Parâmetro    | Descrição                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------- |
| `q`          | Busca por razão social, nome fantasia ou CNPJ (texto normalizado, sem acento e sem caixa) |
| `source`     | `filter` ou `manual`                                                                      |
| `resolution` | `assigned`, `lost` ou `blocked` (E5); o `total` respeita o filtro                         |
| `cursor`     | Cursor opaco da página seguinte (`nextCursor` da resposta anterior)                       |
| `limit`      | Tamanho da página (1 até o teto comum de paginação)                                       |

Parâmetro desconhecido responde `400`. A resposta traz o `total` de itens da prévia (com `q`, `source` e `resolution` aplicados). Teto de `limit`: 200.

## Desempenho

Medido com volume sintético de **50 mil clientes** (meta de trabalho do E2): **~165 ms** para a primeira
página já com o `total`. A prévia é **uma consulta SQL** com `EXISTS` por critério, paginada por cursor.

- **Risco para volumes muito maiores:** o plano percorre `customers` pela chave primária (ordem por `id`)
  e testa a elegibilidade de cada linha; o custo cresce com o número de clientes da base, não só com o de
  elegíveis. Acima de algumas centenas de milhares, reavaliar (índices por filial/região, ou materializar).
- **[auto]** O E4 criou só o índice `portfolio_customer_overrides_customer_id_idx`; nenhum índice novo
  em `customers`. Revisitar se a medição mudar.

## Exemplo

Com token de `admin` (no Compose, `client_id=smoke-admin`: `sub` `admin-01`, filial `filial-01`), numa
carteira com filtro de bairro "Centro de Serra" (Serra/ES).

```http
GET /v1/portfolios/7/preview?q=Cliente%20Alfa&limit=20
-> 200
{ "items": [ {
    "customer": { "id": 41, "cnpj": "90000000000184", "legalName": "Cliente Alfa 1790000000",
                  "tradeName": null, "stateCode": 32, "municipalityCode": 3205002,
                  "municipalityName": "Serra", "neighborhood": "Centro de Serra" },
    "source": "filter",
    "matchedRegionLevel": "neighborhood",
    "matchedBy": { "region": true, "retailNetwork": false, "economicGroup": false },
    "rank": 3, "resolution": "assigned", "competitors": [] } ],
  "nextCursor": null, "total": 1 }

PUT /v1/portfolios/7/overrides      If-Match: "3"
{ "include": [42], "exclude": [41] }
-> 200  ETag: "4"   (carteira completa)

GET /v1/portfolios/7/overrides
-> 200 { "include": [ { "customer": { "id": 42, ... }, "effective": true } ],
         "exclude": [ { "customer": { "id": 41, ... }, "effective": true } ] }

GET /v1/portfolios/7/preview?q=Cliente%20Beta
-> 200 { "items": [ { "customer": { "id": 42, ... }, "source": "manual", "matchedRegionLevel": null, ... } ], "total": 1 }

PUT /v1/portfolios/7/overrides      (sem If-Match)  -> 428 { "error": "precondition_required" }
```

O mesmo fluxo roda em `scripts/smoke.sh`, com CNPJs válidos e únicos gerados a cada execução (módulo 11),
e também pelo proxy da demo (`/api/v1/portfolios/{id}/preview`).

## Erros

Formato `{ "error": "<codigo>", "message"?: "..." }`, sem eco do valor enviado.

| Status | `error`                                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `validation_error` (id em inclusão e exclusão, cliente fora do escopo ou inexistente, inclusão inválida, excesso de 5000, parâmetro inválido) |
| 401    | token ausente ou inválido                                                                                                                     |
| 403    | `forbidden` (sem papel para gravar ajustes)                                                                                                   |
| 404    | `not_found` (carteira inexistente ou fora do escopo)                                                                                          |
| 409    | `portfolio_inactive`, `version_conflict`                                                                                                      |
| 428    | `precondition_required`                                                                                                                       |

## Fica para os próximos épicos

- ~~E5~~ (entregue): conflitos entre carteiras e bloqueio por empate, ver [`api-conflitos.md`](./api-conflitos.md).
- **E6**: distribuição dos clientes entre os vendedores por subgrupo.
- **E7**: finalizar (`draft` -> `active`) e **gravar os vínculos** cliente x vendedor (materialização).
- **E8**: visibilidade por perfil.
- **E9/E10**: telas e arquivos.
