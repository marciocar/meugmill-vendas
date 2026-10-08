# Contexto — carteira-e9-wizard

- **Branch**: feature/carteira-e9-wizard (base: main `4e15b8e`, com E8 e E10 mergeados)
- **Task vinculada**: OG1-T10 · `2723266000000148023` (zoho) — E9, front embarcável (wizard)
- **Criada em**: 2026-10-08 · **Condução**: `/meta:drive` E8–E10, último épico da ordem E8 → E10 → E9
  (aprovações automáticas; merge autorizado quando estiver ok)
- **Objetivo**: o Web Component `<gmill-carteira>` ganha as telas do produto: a lista de carteiras, o
  wizard de 5 etapas (Informações, Filtros, Vendedores, Resumo, Clientes), a importação e a exportação
  CSV do E10 e a consulta "Meus clientes" do E8. Tudo consome a API v1 já entregue; nenhuma regra de
  negócio nova no front.

## Decisões [auto] — orquestrador, 2026-10-08

| Tema | Decisão | Por quê |
|---|---|---|
| Stack | React 19 puro dentro do Shadow DOM, sem roteador nem biblioteca de UI. CSS próprio no shadow root. | O bundle é um arquivo único embarcado no host; cada dependência pesa em todo host. O shell do E1 já é assim. |
| Navegação | Estado interno (abas "Carteiras", "Meus clientes", "Importar e exportar"), sem mexer na URL do host. | O componente não é dono da URL de quem o embarca. |
| Etapas | 1 Informações, 2 Filtros, 3 Vendedores, 4 Resumo, 5 Clientes. A etapa 5 tem prévia com ajustes (E4/E5), distribuição (E6) e finalizar (E7). | É a ordem do documento e da task. As etapas 1–3 gravam ao avançar; a 4 só lê. |
| Versão | O `If-Match` vem do campo `version` do agregado, não do cabeçalho `ETag`. Em `409 version_conflict` a tela relê a carteira e avisa. | O `ETag` não é exposto por CORS a hosts de outra origem; o corpo sempre traz a versão. |
| Permissão na tela | A tela esconde ou desabilita o que o perfil não pode (criar só admin; editar admin ou responsável; supervisão e vendedor só leem; importar só admin). A API continua sendo a autoridade: um 403/404 é mostrado como mensagem. | Evita botão que sempre falha, sem duplicar a regra como verdade. |
| Erros | Mensagens em pt-BR por código (`version_conflict`, `portfolio_incomplete` com `detail`, etc.). A mensagem do domínio, que nunca ecoa valor, é mostrada quando existe. | O contrato de erro do E2 é fechado. |
| 401 | Qualquer 401 dispara `token-expired` (uma vez por token) e mostra "Sessão expirada". | Mesmo contrato do shell do E1. |
| Exportação | `fetch` com o Bearer, blob e download por link temporário dentro do shadow root. | O token não pode ir na URL. |
| Importação | Envia o `File` cru (`Content-Type: text/csv`), sem ler no navegador, e recusa acima de 16 MB antes de enviar. Acompanha o job por consulta a cada 1 s enquanto `validating`/`applying`. | A API detecta a codificação pelos bytes; ler como texto no navegador trocaria a codificação. |
| CORS | A API passa a aceitar `If-Match` e a expor `ETag` e `Content-Disposition`. | Sem isso, toda escrita de host de outra origem falha no preflight. |
| nginx | `client_max_body_size 17m` no proxy `/api/`. | O padrão de 1 MB barrava o CSV do E10 pela demo. |
| Demo | A demo ganha a escolha do perfil do token de teste (admin, gestor, vendedor, supervisão). | Para testar cada perfil sem colar token. |
| LGPD | Nada é guardado em storage; o token só vive na propriedade. A tela mostra só dado de empresa do cliente e o `sub` opaco do responsável. | Contrato do E1 e do E8. |

## Fora do escopo

- Telas de cadastro mestre (filiais, vendedores, clientes, catálogos): a carga é por CSV (E10) e a
  manutenção pelo sistema principal. [INFERIDO] Confirmar com a GMill se o MeuGmill precisa dessas telas.
- Histórico de vínculos e outbox na tela (a API existe; tela fica para quando houver pedido).
