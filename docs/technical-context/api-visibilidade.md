---
updated: 2026-10-08
source: apps/api/src/routes/v1/visibility.ts, apps/api/src/routes/v1/http.ts, apps/api/src/domain/visibility/, apps/api/src/domain/sellers/, apps/api/test/routes/visibility.test.ts, apps/api/test/domain/visibility-volume.test.ts, docker/idp-config.json, scripts/smoke.sh, .claude/sessions/carteira-e8-visibilidade/context.md, .claude/sessions/carteira-e8-visibilidade/architecture.md
---

# API de visibilidade (v1)

Escopo: `apps/api` (MeuGmill Vendas, carteira de clientes), E8. A carteira vale também como **regra de
visibilidade**: o vendedor consulta os clientes ligados a ele; perfis mais amplos consultam mais. O sistema
principal usa esta API para aplicar a mesma regra a pedidos e títulos. O contrato completo está em
[`openapi-v1.json`](./openapi-v1.json); convenções comuns em [`api-dados-mestres.md`](./api-dados-mestres.md).

## Perfis e regra

Os perfis vêm da claim `roles` do token. [INFERIDO] Os nomes são palpite de trabalho, a confirmar com a
GMill; ficam em constantes (`domain/visibility/profiles.ts`). Vários perfis somam. Toda visibilidade fica
limitada às filiais do token (`branch_ids`).

| Perfil       | O que enxerga                                                                          | Escrita |
| ------------ | -------------------------------------------------------------------------------------- | ------- |
| `vendedor`   | Clientes com **vínculo ativo** (E7) com o vendedor ligado ao seu `sub` (`userSub`)     | Não     |
| `gestor`     | Clientes com vínculo ativo nas carteiras em que é responsável (`responsibleSub` = sub) | Não     |
| `admin`      | Todos os clientes ativamente ligados às filiais do token                               | Sim     |
| `supervisao` | Como o admin, **só leitura** (qualquer escrita responde `403`)                         | Não     |

A fonte da verdade são os vínculos gravados no E7, não a prévia de elegibilidade. Vendedor sem `userSub`
ligado não "vê como vendedor": não enxerga cliente algum.

## Ligação login x vendedor (`userSub`)

O vendedor tem `userSub` (opcional, único): o `sub` opaco do login, sem dado pessoal. Só o admin grava,
pelo `POST /v1/sellers` ou `PATCH /v1/sellers/{id}` (`null` ou vazio desliga a ligação; `sub` já usado por
outro vendedor responde `409`). Na leitura de vendedor, só o admin recebe o campo; os demais perfis o
recebem **omitido** (nem `null`), para não revelar a existência da ligação.

## Endpoints

Todos exigem JWT (`401` sem token).

| Rota                        | O que faz                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /v1/me/visibility`     | Resumo: `profiles`, `mode` (`profiles` ou `legacy`), `seller` (`{ id, code }` ou `null`), contagens |
| `GET /v1/me/customers`      | Clientes visíveis, por id crescente. Filtros `q`, `productSubgroupId`; `cursor` e `limit`           |
| `POST /v1/visibility/check` | Corpo `{ "customerIds": [..] }`, até 1.000 ids distintos; devolve `{ "visible": [..] }`             |

- `GET /v1/me/customers` devolve `{ items, nextCursor, total }`. Cada item traz os dados de empresa do
  cliente e `via`: a lista de `{ productSubgroupId, portfolioId, profile }` dos vínculos ativos que o
  tornam visível (vazia quando só a leitura ampla da filial o mostra). Não traz dado de paciente.
- `POST /v1/visibility/check` é **leitura** (POST só pelo tamanho do corpo): qualquer perfil o usa. Mais de
  1.000 ids, id repetido ou id inválido (`< 1`) responde `400`. Cliente inexistente, de outra filial ou sem
  visibilidade **não voltam**, e a resposta não os diferencia.

### Como o sistema principal filtra pedidos e títulos

1. Para uma tela de pedidos ou títulos, junte os `customerId` da página (até 1.000).
2. Chame `POST /v1/visibility/check` com o token do **usuário** (não um token de serviço) e `customerIds`.
3. Mostre só os registros cujo cliente está em `visible`. Para listar a partir do cliente, use
   `GET /v1/me/customers` (paginado) e consulte pedidos e títulos desses clientes.

A chamada em lote evita uma consulta por pedido. O resultado vale para aquele instante: não guarde em cache
por mais que a tela.

## Restrição das leituras do próprio serviço

A leitura de clientes (E2) e de carteiras (E3) para quem **não** é admin, supervisão nem `legacy` fica
restrita. Detalhes em [`api-dados-mestres.md`](./api-dados-mestres.md) e
[`api-carteiras.md`](./api-carteiras.md).

## Modo `legacy` (risco aberto)

Um token **sem nenhum** dos perfis conhecidos mantém a leitura de antes do E8 (todos os dados das filiais do
token) e gera um log de aviso `legacy_access` com **só** o nome do recurso (`resource`): nunca `sub`,
papéis, filiais nem dado de negócio. `GET /v1/me/visibility` mostra `mode: "legacy"`.

**Risco aberto, decisão do maestro:** fechar isso (negar por padrão) depende de a GMill confirmar os nomes
dos perfis. Enquanto isso, qualquer token com papel desconhecido lê a filial inteira.

## Desempenho (medido, volume do E8)

Base de 50 mil clientes e 150 mil vínculos ativos, SQLite em memória (`test:perf`, teto de 300 ms):

| Operação                                           | Tempo medido |
| -------------------------------------------------- | -----------: |
| `GET /v1/me/customers`, vendedor, uma página       |       ~40 ms |
| `POST /v1/visibility/check`, 1.000 ids             |       ~14 ms |
| `GET /v1/me/customers`, gestor com 50 mil clientes |       ~92 ms |

## Decisões `[auto]`

- Login ligado ao vendedor por `userSub` opcional e único, gravado só pelo admin.
- Perfis lidos de `roles`; nomes são palpite e ficam em constantes; vários perfis somam.
- Visibilidade parte dos vínculos ativos do E7 e respeita as filiais do token.
- `check` em lote, com até 1.000 ids distintos, sem diferenciar inexistente de invisível.
- Token sem perfil conhecido segue em `legacy`, com aviso no log (risco aberto acima).
- O aviso `legacy` é ligado ao logger da app por `serviceOptions` (`routes/v1/http.ts`).

## IdP de teste e smoke

O mock emite, por `client_id`: `smoke-vendedor` (sub `vend-01`), `smoke-gestor` (`gest-01`) e
`smoke-supervisao` (`sup-01`), todos com a filial `filial-01`, além de `smoke-admin`. O mock lê a config só ao
subir: recrie o `idp` depois de mudar `docker/idp-config.json`. O `scripts/smoke.sh` liga `vend-01` a um
vendedor (limpando o de execuções anteriores), confere `me/customers` e `check` com o token dele, e a
supervisão com `403` em escrita.

## Fica para os próximos épicos

Tela (E9) e arquivo (E10).
