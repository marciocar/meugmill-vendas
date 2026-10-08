---
updated: 2026-10-08
source: apps/web/src/, apps/web/demo/index.html, docker/nginx.conf, apps/api/src/app.ts, scripts/smoke.sh, .claude/sessions/carteira-e9-wizard/context.md
---

# Front embarcável `<gmill-carteira>` (E9)

Escopo: `apps/web`, o Web Component que o sistema principal embarca. Ele consome a API v1 (ver os
`api-*.md` deste diretório) e não tem regra de negócio própria: tudo o que ele mostra ou grava passa pela
API, que continua sendo a autoridade. As decisões marcadas **[auto]** estão em
`.claude/sessions/carteira-e9-wizard/context.md`.

## Contrato com o host

O contrato nasceu no E1 e não mudou:

- O host carrega `gmill-carteira.js` (um arquivo ES, com React embutido) e põe `<gmill-carteira api-base="…">`
  na página.
- O host passa o JWT do usuário pela **propriedade** `token`. Ela nunca vira atributo, nunca vai para
  storage nem para a URL.
- Quando a API recusa o token (401), o componente emite o evento `token-expired` (bubbles + composed), uma
  vez por token, e mostra "Sessão expirada". As telas **continuam montadas**. Se o host renova o token e o
  `sub` é o mesmo, o usuário segue de onde parou, inclusive no meio do wizard.
- Todo o CSS fica no shadow root (aberto). O componente não mexe na URL do host: a navegação é interna,
  por abas.

## Telas

| Aba | O que faz | API |
|---|---|---|
| Carteiras | Lista com busca, situação e ativa; "Nova carteira" (só admin); abre o wizard | `GET /v1/portfolios` |
| Wizard 1, Informações | Cria o rascunho ou altera **só o que mudou** | `POST`/`PATCH /v1/portfolios` |
| Wizard 2, Filtros | Regiões (estado, município, bairro), redes e grupos; grava o conjunto | `PUT /filters`, `/v1/geo/*` |
| Wizard 3, Vendedores | Pares vendedor x subgrupo (só vendedores ativos na filial da carteira) | `PUT /sellers` |
| Wizard 4, Resumo | Leitura do agregado, com ajustes e conflitos | `GET /v1/portfolios/{id}?include=conflicts` |
| Wizard 5, Clientes | Prévia com disputa, ajustes (excluir, incluir, desfazer), distribuição manual e automática, finalizar | `/preview`, `/overrides`, `/assignments`, `/distribute`, `/finalize`, `/links` |
| Meus clientes | Resumo da visibilidade e clientes visíveis | `/v1/me/visibility`, `/v1/me/customers` |
| Importar e exportar | Dicionário dos layouts, exportação, envio com simulação, relatório por linha, confirmar ou cancelar, histórico | `/v1/csv-layouts`, `/v1/exports/*`, `/v1/imports*` |

Inativar e reativar ficam no cabeçalho do wizard, só para o admin da filial.

## Regras da tela

- **Versão.** Toda escrita manda `If-Match: "<versão>"`, e a versão vem do **corpo** do agregado, não do
  cabeçalho `ETag`. Em `409 version_conflict`, a tela relê a carteira e avisa. A etapa aberta **recomeça da
  versão nova** e descarta o rascunho. Assim a próxima gravação não devolve dados velhos com a versão nova,
  o que reverteria a gravação da outra pessoa sem conflito. Uma leitura que chega depois de uma escrita mais
  nova é ignorada.
- **Ajustes.** O `PUT /overrides` substitui o conjunto inteiro. Por isso a tela só oferece "excluir",
  "incluir" e "desfazer" quando a lista de ajustes foi lida na versão atual da carteira. Enquanto ela relê,
  os botões ficam desabilitados: um segundo clique rápido apagaria o ajuste anterior. Gravar ajustes pela tela também
  apaga os ajustes órfãos, que o `GET /overrides` não lista (ver `api-elegibilidade.md`).
- **Edição não salva.** As etapas 1 a 3 avisam o wizard quando têm edição pendente. Trocar de etapa ou
  voltar à lista pede confirmação ("Descartar e sair da etapa").
- **Ações que encerram vínculos.** Inativar a carteira e trocar a filial pedem confirmação explícita.
- **Troca de usuário.** O cabeçalho e as telas só aparecem quando o `/v1/me` do token atual confirmou o
  usuário. Enquanto ele não responde, as telas ficam ocultas. Se ele falha para um token nunca confirmado,
  o usuário anterior sai da tela. É uma troca consciente: na renovação do mesmo usuário com o `/v1/me`
  falhando, a tela também sai e a edição não salva se perde, porque a tela não sabe se o `sub` é o mesmo.
  Um 401 de uma requisição feita com um token que o host já trocou não emite `token-expired`.
- **Abas.** As abas visitadas ficam montadas, só escondidas: trocar de aba não descarta o wizard. As
  listas releem ao reexibir a aba (por exemplo, carteiras criadas por uma importação noutra aba).
- **Permissão.** A tela esconde ou trava o que o perfil não pode: criar é só do admin; editar, do admin da
  filial ou do responsável; inativar e trocar filial ou responsável, só do admin da filial. A etapa 5 aparece
  para admin, supervisão, o responsável e o token sem perfil conhecido (`legacy`). A importação é só do admin. Mesmo assim, um 403 ou 404 da API é
  mostrado como mensagem (`src/roles.ts`).
- **Erros.** Mensagens em pt-BR por código (`src/api/errors.ts`). A mensagem fixa do domínio, que nunca
  ecoa o valor enviado, é mostrada nos 4xx. Para `portfolio_incomplete` e `portfolio_has_conflicts`, a tela
  usa as contagens do `detail`. Uma resposta fora do contrato derruba só a aba, que mostra "Erro inesperado
  nesta tela" e um botão para tentar de novo.
- **CSV.** O arquivo vai cru (`Content-Type: text/csv`), sem ser lido no navegador, porque a API detecta a
  codificação pelos bytes. Acima de 16 MB, a tela recusa antes de enviar. O job é consultado a cada 1 s
  enquanto está `validating` ou `applying`. Se uma consulta falha por rede ou 5xx, inclusive a primeira, a tela tenta
  de novo com espera crescente, até 15 s. Em 401, 403 ou 404 ela para e mostra a mensagem. O erro de confirmar ou cancelar fica na tela até a próxima ação. Uma simulação com o prazo vencido não oferece confirmar, mesmo antes de a varredura
  da API marcá-la `expired`. O relatório abre nas linhas com erro primeiro.
- **Exportação.** Um `fetch` com o Bearer baixa o arquivo, e um link temporário dentro do shadow root
  dispara o download. O token não vai na URL.
- **LGPD.** Nada em storage. A tela mostra só dado de empresa do cliente e o `sub` opaco do responsável.

## Infraestrutura mudada no E9

- **CORS da API** (`apps/api/src/app.ts`): aceita `If-Match` e expõe `ETag` e `Content-Disposition`. Sem
  isso, toda escrita de um host de outra origem falhava no preflight.
- **nginx** (`docker/nginx.conf`): `client_max_body_size 17m` no proxy `/api/`. O padrão de 1 MB barrava o
  CSV.
- **Demo** (`apps/web/demo/index.html`): escolha do perfil do token de teste (admin, gestor, vendedor,
  supervisão).
- **Smoke**: um upload de 2 MB pelo proxy e um preflight de escrita com `If-Match`.

## Testes

- Testes com vitest e happy-dom (`apps/web/src/*.test.tsx`), com um `fetch` falso por rota
  (`src/test-utils.tsx`). Cobrem:
  - o cliente da API;
  - a criação pelo wizard;
  - o `version_conflict`;
  - o vendedor só lendo;
  - a finalização com `portfolio_incomplete`;
  - os ajustes;
  - o 401 vindo de uma tela;
  - o envio, a consulta e a confirmação do CSV;
  - o limite de 16 MB;
  - a simulação com erro;
  - a exportação;
  - os modos de falha da revisão adversarial: 409 na etapa 1, gravação de ajustes com a lista relendo,
    inativar sem confirmar, troca de etapa com edição pendente, troca de token para outro usuário, falha na
    consulta do job e simulação vencida. Os dois testes dos achados de perda de dados falham quando a
    correção é desfeita.
- O fluxo inteiro também foi exercido num Chromium headless contra o Compose (demo real). Esse teste pegou
  um defeito de uso que os testes unitários não pegavam: a lista de carteiras concorrentes estourava a
  tabela da prévia.

## Limites conhecidos

- **Bundle**: 453 kB (103 kB com gzip), React incluído.
- **Listas de seleção** (filiais, tipos, redes, grupos, vendedores e subgrupos) carregam até 2.000 itens e
  **cortam o excedente sem aviso**. Um catálogo maior precisaria de busca no servidor.
- **Gestor responsável** quase não consegue incluir clientes à mão. A busca usa `/v1/customers`, que pelo E8
  só devolve ao gestor os clientes que ele já vê. A API aceita o ajuste; o que falta é um jeito de buscar o
  cliente da filial.
- Sem telas de cadastro mestre (filiais, vendedores, clientes, catálogos): a carga é por CSV.
  [INFERIDO] Confirmar com a GMill se o MeuGmill precisa delas.
- O histórico de vínculos e a outbox não têm tela.
