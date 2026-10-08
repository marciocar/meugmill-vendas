---
updated: 2026-10-08
source: apps/api/src/routes/v1/portfolios.ts, apps/api/src/domain/portfolios/name-key.ts, apps/api/src/routes/v1/portfolio-types.ts, apps/api/src/domain/portfolios/, apps/api/src/domain/portfolio-types/, apps/api/src/domain/shared/normalize.ts, apps/api/src/domain/shared/authz.ts, scripts/smoke.sh, .claude/sessions/carteira-e3-cadastro-carteira/architecture.md, .claude/sessions/carteira-e3-cadastro-carteira/context.md
---

# API da carteira (v1)

Escopo: `apps/api` (MeuGmill Vendas, carteira de clientes), etapas 1 a 4 do wizard (E3). Este documento
resume o contrato; o contrato completo e gerado do código está em [`openapi-v1.json`](./openapi-v1.json).
Convenções comuns (JWT, paginação, erros sem eco, `ETag`) vêm de [`api-dados-mestres.md`](./api-dados-mestres.md).

## O que é a carteira

A carteira organiza quais clientes cada vendedor atende, por filial. É um **agregado** com quatro partes,
uma por etapa do wizard:

| Etapa | Parte                  | Como se grava                                                                                      |
| ----- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| 1     | Informações            | `POST /v1/portfolios` cria o rascunho (nome, descrição, filial, responsável, tipo); `PATCH` altera |
| 2     | Filtros                | `PUT /v1/portfolios/{id}/filters` substitui o conjunto inteiro                                     |
| 3     | Vendedores x subgrupos | `PUT /v1/portfolios/{id}/sellers` substitui o conjunto inteiro                                     |
| 4     | Resumo                 | `GET /v1/portfolios/{id}` devolve o agregado completo                                              |

Rotas: `GET /v1/portfolios` (lista resumida: `q`, `branchId`, `status`, `active`, `responsibleSub`,
`cursor`, `limit`), `GET|PATCH /v1/portfolios/{id}`, `PUT .../filters`, `PUT .../sellers`,
`POST .../deactivate` e `POST .../reactivate`. O tipo de carteira é um catálogo `code + name` em
`/v1/portfolio-types` (mesmas rotas dos demais catálogos do E2). O tipo só classifica; não muda regra.

O nome é único por filial, comparado pela chave normalizada: sem acento, sem caixa e **sem pontuação**
(qualquer sequência de caracteres que não sejam letras ou dígitos, como `—`, `-`, `–`, `/` e `,`, vira um
único espaço). "Norte — Farmácias", "norte - farmacias" e "NORTE/FARMÁCIAS" são o mesmo nome. Vale também
entre carteiras inativas, e repetir o nome responde `409 conflict`. Nome só com pontuação responde `400`.
A busca `q` da lista usa a mesma normalização (`q=norte farmacias` acha "Norte — Farmácias").
No boot, a API recalcula uma vez as chaves gravadas com a regra anterior (idempotente; se duas carteiras
da mesma filial passarem a colidir, a segunda mantém a chave antiga).

## Ciclo de vida

Dois eixos independentes:

- `status`: `draft` -> `active`. A carteira nasce `draft`. A ativação ("finalizar") só entra no **E7**,
  junto com a gravação dos vínculos; até lá nenhuma rota muda o `status`.
- `active` (inativação): `deactivate` e `reactivate`, idempotentes, com `If-Match`. Não há exclusão. Um
  rascunho pode ser inativado (abandonado) e uma carteira `active` também.
- **Inativar ou transferir de filial** (carteira ou filial) volta a carteira a `draft` e encerra os seus
  vínculos, com eventos (ver [`api-vinculos.md`](./api-vinculos.md)). Reativar também deixa `draft`.
- **Carteira inativa não é editável**: `PATCH`, `PUT /filters` e `PUT /sellers` respondem
  `409 portfolio_inactive`. A checagem vem depois de 404 (escopo), 403 (permissão) e 428 (sem `If-Match`),
  e **antes** da comparação de versão, para que quem tem a tela desatualizada saiba que o problema é a
  carteira inativa, e não uma versão velha. Para editar, reative.
- **Reativar revalida**: a filial da carteira precisa estar ativa e o tipo também; senão `400
validation_error` e a carteira continua inativa. Vendedores com vínculo inativo **não** bloqueiam a
  reativação (o E6/E7 tratam). Reativar uma carteira já ativa é no-op e não revalida.

## Autorização

| Operação                                 | Regra                                                             |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Ler (lista e `GET`)                      | Carteiras cuja filial está em `branch_ids` do token               |
| Criar                                    | `admin` com a filial da carteira no token                         |
| Editar informações, filtros e vendedores | `admin` da filial **ou** o responsável (`responsibleSub` = `sub`) |
| Trocar filial ou responsável             | Só `admin`; a nova filial também precisa estar no token           |
| Inativar e reativar                      | Só `admin` da filial                                              |

- **Ordem dos erros nas escritas**: 404 (escopo), 403 (permissão de editar; trocar filial ou responsável
  também é decidido aqui, antes da versão), 428 (sem `If-Match`), 409 `portfolio_inactive`, 409
  `version_conflict`, e por fim as validações de negócio (400).
- **`responsibleSub` é opaco**: só recebe `trim` (sem colapsar espaços internos) e é comparado de forma
  exata, com diferença entre maiúsculas e minúsculas, ao gravar, no filtro da lista e na permissão do
  responsável.
- **Fora do escopo = 404**: carteira de filial que não está no token responde `404 not_found`, igual a
  uma inexistente. Quem está no escopo mas não pode a operação recebe `403 forbidden`.
- **Responsável só como `sub`**: a carteira guarda e devolve apenas o `sub` do usuário do IdP, sem nome nem
  e-mail (LGPD). Quem exibe o nome é o sistema principal. Vendedores e subgrupos saem como
  `{ id, code, name }`.
- **Leitura para todos da filial**: qualquer autenticado com a filial no token lê as carteiras dela.
  [INFERIDO] O refinamento por perfil ("vendedor só vê onde atua") depende de ligar o `sub` a um vendedor,
  o que fica para o E8.

## Filtros (`PUT /filters`)

Corpo: `{ regions[], retailNetworkIds[], economicGroupIds[] }`. O `PUT` **substitui** o conjunto; vazio
limpa a seção. Duplicata dentro do mesmo `PUT` responde `400`.

- **Regiões** têm um nível: `state` (`stateCode`), `municipality` (+ `municipalityCode`, que precisa ser
  da UF) e `neighborhood` (+ `municipalityCode` e `neighborhoodLabel`). Códigos são os do IBGE
  (`/v1/geo/states`, `/v1/geo/municipalities`).
- **Bairro exige município.** O bairro é gravado com uma chave normalizada (maiúsculas, sem acento,
  espaços colapsados: " Jardim Câmburi " vira `JARDIM CAMBURI`) e o texto original em
  `neighborhoodLabel`, para exibir. Duas grafias do mesmo bairro contam como duplicata.
- **Semântica do casamento**: dentro de um critério vale **OU** (o cliente casa com alguma das regiões,
  ou alguma das redes, ou algum dos grupos); entre os critérios preenchidos vale **E**. O nível da região
  que casou servirá à prioridade bairro > cidade > estado no E5.
- Redes e grupos econômicos precisam existir e estar ativos.
- Bairro só com pontuação (sem letra nem dígito) responde `400`.
- [INFERIDO] Carteira sem nenhum filtro é permitida, para quem monta só com inclusão manual (E4).

## Vendedores x subgrupos (`PUT /sellers`)

Corpo: `{ assignments: [{ sellerId, productSubgroupId }] }`. Substitui o conjunto; vazio limpa. Um vendedor
pode ter vários subgrupos e um subgrupo vários vendedores (o E6 divide entre eles).

- O vendedor precisa ter **vínculo ativo** com a filial da carteira, e o subgrupo precisa estar ativo.
- O vendedor também precisa estar **ativo globalmente**.
- **Troca de filial incompatível = 400**: o admin só troca a `branchId` (no `PATCH`) se a filial nova
  estiver ativa e todos os vendedores do conjunto passarem na mesma validação (ativos e com vínculo ativo
  com a filial nova).
- A validação ocorre só na escrita; vendedor que perde o vínculo depois é tratado no E6/E7.

## Concorrência

Há **uma versão única no agregado**: toda escrita (`PATCH`, `PUT`, `deactivate`, `reactivate`) a incrementa.
Toda resposta de carteira traz `ETag: "<version>"`; toda escrita exige `If-Match`.

- Sem `If-Match`: `428 precondition_required`. Versão desatualizada: `409 version_conflict`. Header
  malformado: `400 validation_error`.
- Consequência: duas pessoas salvando etapas diferentes ao mesmo tempo geram um 409 para a segunda, que
  relê o agregado e repete. O custo foi aceito pela simplicidade.

## Fluxo do wizard (exemplo)

Com token de `admin` (no Compose, `client_id=smoke-admin`: `sub` `admin-01`, filial `filial-01`).

```http
POST /v1/portfolios
{ "name": "Carteira Norte", "branchId": 1, "responsibleSub": "admin-01", "portfolioTypeId": 1 }
-> 201  ETag: "1"   { "id": 7, "status": "draft", "active": true, "filters": {...}, "sellers": [], ... }

PUT /v1/portfolios/7/filters      If-Match: "1"
{ "regions": [
    { "level": "state", "stateCode": 32 },
    { "level": "municipality", "stateCode": 32, "municipalityCode": 3205002 },
    { "level": "neighborhood", "stateCode": 32, "municipalityCode": 3205002, "neighborhoodLabel": "Centro de Serra" } ],
  "retailNetworkIds": [], "economicGroupIds": [] }
-> 200  ETag: "2"

PUT /v1/portfolios/7/sellers      If-Match: "2"
{ "assignments": [ { "sellerId": 3, "productSubgroupId": 5 } ] }
-> 200  ETag: "3"

GET /v1/portfolios/7
-> 200  ETag: "3"   { "status": "draft", "filters": { "regions": [3 itens], ... }, "sellers": [ { "seller": {...}, "productSubgroup": {...} } ], ... }

PATCH /v1/portfolios/7   (sem If-Match)  -> 428 { "error": "precondition_required" }
```

O mesmo fluxo roda em `scripts/smoke.sh`.

## Erros

Formato `{ "error": "<codigo>", "message"?: "..." }`, sem eco do valor enviado.

| Status | `error`                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `validation_error` (região incoerente, referência inexistente ou inativa, vendedor sem vínculo, duplicata, filial incompatível) |
| 401    | token ausente ou inválido                                                                                                       |
| 403    | `forbidden` (sem papel para a operação)                                                                                         |
| 404    | `not_found` (inexistente ou fora do escopo)                                                                                     |
| 409    | `conflict` (nome já existe na filial), `portfolio_inactive` (edição de carteira inativa), `version_conflict`                    |
| 428    | `precondition_required`                                                                                                         |

## Contrato OpenAPI

Em execução: `GET /v1/openapi.json`. Estático versionado: [`openapi-v1.json`](./openapi-v1.json), gerado por
`pnpm --filter @meugmill/api openapi:export`; um teste falha se divergir do código.

## Fica para os próximos épicos

- **E4**: prévia de clientes pelos filtros e inclusão manual.
- **E5**: conflitos entre carteiras (prioridade bairro > cidade > estado).
- **E6**: distribuição dos clientes entre os vendedores por subgrupo.
- **E7**: finalizar (`draft` -> `active`) e gravar os vínculos cliente x vendedor.
- **E8**: visibilidade por perfil (ligar o `sub` a um vendedor).
- **E9/E10**: telas e arquivos.
