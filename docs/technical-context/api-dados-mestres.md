---
updated: 2026-10-08
source: apps/api/src/routes/v1/, apps/api/src/domain/shared/links.ts, apps/api/src/domain/shared/authz.ts, apps/api/src/domain/shared/errors.ts, apps/api/src/domain/shared/pagination.ts, apps/api/src/domain/shared/cnpj.ts, apps/api/src/plugins/openapi.ts, .claude/sessions/carteira-e2-dados-mestres/architecture.md
---

# API de dados mestres (v1)

Escopo: `apps/api` (MeuGmill Vendas, carteira de clientes). Este documento resume o contrato; o
contrato completo e gerado do código está em [`openapi-v1.json`](./openapi-v1.json).

## Recursos

Todos sob `/v1`, autenticados por JWT Bearer (exceto `GET /v1/openapi.json`, `/health` e `/ready`).

| Recurso                                                                                                 | Rotas                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branches` (filiais), `product-subgroups`, `retail-networks`, `economic-groups`, `sellers`, `customers` | `GET /v1/{recurso}` (lista), `GET /v1/{recurso}/{id}`, `POST /v1/{recurso}`, `PATCH /v1/{recurso}/{id}`, `POST /v1/{recurso}/{id}/deactivate`, `POST /v1/{recurso}/{id}/reactivate`                                                 |
| Vínculo de cliente                                                                                      | `POST /v1/customers/by-cnpj/{cnpj}/branches` com `{ "branchId": n }`: liga um cliente já cadastrado (em outra filial) à filial do admin. Idempotente. Responde `200` com **só** `{ id, version }` e `ETag`: nenhum dado do cliente. |
| Vínculo de vendedor                                                                                     | `POST /v1/sellers/by-code/{code}/branches` com `{ "branchId": n }`: mesma regra e mesma resposta (`{ id, version }`).                                                                                                               |
| Localidades IBGE                                                                                        | `GET /v1/geo/states`, `GET /v1/geo/municipalities?uf=&q=` (somente leitura)                                                                                                                                                         |
| Sessão                                                                                                  | `GET /v1/me` (sub, papéis e filiais do token)                                                                                                                                                                                       |
| Contrato                                                                                                | `GET /v1/openapi.json` (público, só o JSON; sem interface visual)                                                                                                                                                                   |

Catálogos (subgrupos, redes, grupos econômicos) têm `code` (imutável) e `name`. Clientes e vendedores
recebem `branchIds` (ids internos) no corpo; as respostas trazem as filiais como
`{ id, code, name, active }`, onde `active` é o estado do **vínculo** com a filial (ver "Inativação").

## Autorização

- **Leitura**: qualquer usuário autenticado, dentro do seu escopo.
- **Escrita** (POST, PATCH, deactivate, reactivate, vínculo): somente o papel `admin`. Outro papel recebe
  `403 forbidden`.
- **Escopo por filial**: o claim de filiais do token (`branch_ids`) traz **códigos de filial**
  (`branches.code`) [INFERIDO: a hipótese é que o IdP emita códigos, não ids internos]. Códigos sem
  filial cadastrada são ignorados. O escopo inclui filiais inativas.
- **Fora do escopo = 404**: ler ou alterar um registro que não intersecta o escopo do ator responde
  `404 not_found`, igual a um registro inexistente, para não revelar que ele existe.
- **Dados compartilhados**: cliente e vendedor são um registro único para todas as filiais. Alterar
  no `PATCH` um campo compartilhado (cliente: `legalName`, `tradeName`, `municipalityCode`, `stateCode`,
  `neighborhood`, `retailNetworkId`, `economicGroupId`; vendedor: `name`) exige um admin cujo token
  tenha **todas** as filiais vinculadas ao registro; caso contrário `403 forbidden`. Reenviar o valor
  atual não conta como alteração. Alterar só `branchIds` (dentro do escopo) continua permitido a
  qualquer admin com pelo menos uma filial do registro.
- **Link sem vazamento**: o link por CNPJ/código só devolve `{ id, version }`. Os dados do registro só
  ficam visíveis depois do link, pelo `GET` normal, já dentro do escopo do ator.
- **Filiais nas respostas**: as respostas de cliente e de vendedor listam apenas as filiais que estão no
  escopo do ator; vínculos com outras filiais não aparecem.
- Token sem filiais enxerga zero clientes e vendedores (falha fechada).

## Concorrência otimista

- Toda leitura e escrita bem-sucedida de um registro devolve `ETag: "<version>"`.
- `PATCH`, `deactivate` e `reactivate` exigem `If-Match: "<version>"` (aceita também `3` e `W/"3"`).
- Sem o header: `428 precondition_required`. Versão desatualizada: `409 version_conflict`.
  Header malformado (`*`, vazio, versão 0): `400 validation_error`.
- Fluxo: `GET` -> guardar o `ETag` -> enviar no `If-Match` -> usar o `ETag` novo da resposta.

## Inativação

Não há exclusão. `deactivate` marca o registro como inativo e `reactivate` o devolve; ambos são
idempotentes quando já estão no estado pedido. Listas aceitam `active=true|false`.

**Catálogos e filiais:** o `active` é do próprio registro.

**Clientes e vendedores (compartilhados entre filiais): ativo por vínculo, com rotas globais
explícitas.** Cada vínculo cliente/vendedor x filial tem o seu `active`; o registro tem ainda o
`active` global. Não há escalada implícita: cada escopo tem a sua rota.

`POST /v1/{customers|sellers}/{id}/deactivate|reactivate` (escopo vínculo):

- age **sempre e só nos vínculos das filiais do token** que o registro tem no escopo, por vínculo e
  de forma idempotente; o `active` global **nunca** muda aqui, mesmo que o admin cubra todas as
  filiais do registro;
- quando algo muda, exige `If-Match` (`428`/`409`) e incrementa a `version` uma vez; quando nada muda,
  responde `200` sem exigir versão atual nem alterá-la;
- fora do escopo: `404`, sem mudar a versão.

`POST /v1/{customers|sellers}/{id}/deactivate-global|reactivate-global` (escopo registro):

- mudam o `active` **global** do registro e não mexem nos vínculos;
- exigem admin com **todas** as filiais vinculadas ao registro no token; caso contrário `403 forbidden`
  (sem alterar a versão). Registro fora do escopo continua `404`;
- `If-Match` obrigatório quando algo muda (`428`/`409`); idempotente quando já está no estado pedido;
  incrementa a `version` uma vez;
- registro inativo globalmente some de `active=true` para todas as filiais; reativar vínculos não o
  reativa, só `reactivate-global`.

Filiais e catálogos (sem vínculo) seguem com `deactivate`/`reactivate` globais e não têm rotas `-global`.

O `active` da resposta e o filtro `active` da listagem refletem a visão do ator: **ativo = registro
global ativo E ao menos um vínculo ativo dentro do escopo dele**. Inativar um vínculo não esconde o
registro do ator (ele continua enxergando e pode reativar). Vincular uma filial inativa continua
`400 validation_error`. Inativar filial, rede ou grupo econômico não esconde nem trava registros já
ligados; só impede novas ligações a eles.

## Paginação por cursor

`GET /v1/{recurso}?q=&active=&cursor=&limit=` devolve `{ items, nextCursor }`. `limit` vai de 1 a 200
(default 50). `nextCursor` é opaco (base64url do último id entregue) e `null` na última página: envie-o
de volta em `cursor`. Cursor inválido responde `400 validation_error`. `q` busca por código ou nome (no
cliente: CNPJ, razão social ou nome fantasia). A busca por nome é insensível a acento e caixa
(`q=sao` acha "DROGARIA SÃO JOSÉ"), comparando `q` normalizado com colunas `*_key` gravadas em cada
escrita; `%` e `_` em `q` são literais. Cursor e `q` nunca devolvem registro fora do escopo.

## CNPJ

Aceita o CNPJ numérico (14 dígitos) e o alfanumérico da IN RFB nº 2.229/2024 (12 primeiras posições em
`0-9A-Z` e 2 dígitos verificadores numéricos), com ou sem máscara. O valor é normalizado (sem
pontuação, maiúsculas) e o dígito verificador é validado. No path, a máscara chega codificada
(`%2F`). CNPJ repetido responde `409` (`customer_exists`). Código de vendedor repetido responde `409 seller_exists`; código repetido nos
demais cadastros, `409 conflict`.

## Localidades IBGE

Estados e municípios vêm de um snapshot do IBGE de **2026-10-08**, carregado por migration
(`apps/api/drizzle/0002_seed_ibge.sql`). Fonte: API de localidades do IBGE (estados e municípios).
Atualizar é uma nova migration gerada por `apps/api/scripts/build-ibge-seed.ts`, nunca no boot.

## Erros

Formato `{ "error": "<codigo>", "message"?: "..." }`. O `message` só existe em `validation_error`, com
texto fixo do domínio. **Nenhuma resposta de erro ecoa o valor enviado** (LGPD).

| Status | `error`                                                            |
| ------ | ------------------------------------------------------------------ |
| 400    | `validation_error`                                                 |
| 401    | token ausente ou inválido                                          |
| 403    | `forbidden`                                                        |
| 404    | `not_found`                                                        |
| 409    | `conflict`, `customer_exists`, `seller_exists`, `version_conflict` |
| 428    | `precondition_required`                                            |

## Contrato OpenAPI

- Em execução: `GET /v1/openapi.json` (OpenAPI 3, sem autenticação, security scheme `bearerAuth`).
- Estático versionado: [`openapi-v1.json`](./openapi-v1.json), gerado por
  `pnpm --filter @meugmill/api openapi:export`. Um teste falha se o arquivo divergir do código; ao mudar
  uma rota ou schema, regenere o arquivo e versione junto.
- O cliente da GMill deve ser gerado a partir desse arquivo.

## IdP de teste

No Compose, o mock-oauth2-server emite papel `vendedor` por padrão e `admin` (filial `filial-01`) quando
o `client_id` é `smoke-admin`. Detalhes no comentário do serviço `idp` em `compose.yaml`.
