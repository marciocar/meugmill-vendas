# Contexto — carteira-e8-visibilidade

- **Branch**: feature/carteira-e8-visibilidade (base: main `ba25a96`)
- **Task vinculada**: OG1-T9 · `2723266000000151016` (zoho) — E8; 8 story points
- **Criada em**: 2026-10-08 · **Condução**: `/meta:drive` E8–E10 (aprovações automáticas; merge humano em lote;
  branches empilhadas E8 → E10 → E9)
- **Objetivo**: a carteira como **regra de visibilidade**. O vendedor consulta os clientes associados a ele,
  e perfis mais amplos consultam mais. O sistema principal recebe uma consulta para aplicar a mesma regra a
  pedidos e títulos.

## Regra (documento)

"A carteira serve também como regra de visibilidade. Em geral, o vendedor consulta os clientes associados a
ele; administradores e usuários com permissão específica podem consultar uma carteira mais ampla. A mesma
regra de acesso também é aplicada a dados relacionados, como pedidos e títulos financeiros."

## Decisões [auto] — orquestrador, 2026-10-08

Base: as decisões de trabalho de perfis (`carteira-de-clientes-hipoteses.md`, `[INFERIDO] palpite`), que
continuam a confirmar com a GMill. Os perfis são lidos da claim `roles`.

| Tema | Decisão | Por quê |
|---|---|---|
| Login × vendedor | O vendedor ganha `userSub` (opcional, único), que liga o cadastro ao `sub` do login. Só o admin grava o campo, pelo PATCH do E2. Sem `userSub` o vendedor não "vê como vendedor". | Faltava ligar o login ao cadastro (pendência do E3). O `sub` é opaco, sem dado pessoal. |
| Perfis | `vendedor`: os clientes com **vínculo ativo (E7)** com ele, nos subgrupos dele. `gestor`: os clientes com vínculo ativo nas carteiras em que é **responsável** (`responsible_sub`). `admin`: todos os clientes das filiais do token. `supervisao`: como o admin, **só leitura**. Vários perfis somam. | É a decisão de trabalho, e a fonte da verdade são os vínculos gravados do E7, não a prévia. |
| Escopo de filial | Toda visibilidade fica limitada às filiais do token, como em todo o serviço. | Invariante desde o E2. |
| Consulta para o sistema principal | `GET /v1/me/visibility` devolve o resumo (perfis efetivos e contagens); `GET /v1/me/customers` devolve os clientes visíveis paginados, com os subgrupos pelos quais cada um é visível; `POST /v1/visibility/check` recebe `{ customerIds }` (até 1.000) e devolve os visíveis, para filtrar pedidos e títulos em lote. | É a "consulta de visibilidade" das decisões de trabalho. A checagem em lote evita uma chamada por pedido. |
| Aplicar a regra ao próprio serviço | A leitura de **clientes** (E2) e de **carteiras** (E3), para quem **não** é admin, supervisão nem gestor, fica restrita: o vendedor lê só os clientes visíveis e as carteiras em que atua. Prévia, ajustes, atribuições e vínculos ficam restritos a admin, supervisão e ao responsável da carteira. | "Vendedor só lê as carteiras em que atua" estava adiado do E3 para cá. |
| Compatibilidade | Um token **sem** nenhum dos perfis conhecidos mantém a leitura de hoje (todos os dados das filiais do token), com um log de aviso. Isso fica registrado como **risco**. | Não quebrar integrações enquanto a GMill não confirma os nomes dos perfis. Ver o risco 1. |
| Desempenho | `GET /v1/me/customers` de um vendedor e `POST /check` com 1.000 ids em ≤ 300 ms, com 150 mil vínculos ativos. | É consulta quente: o sistema principal chama a cada tela de pedidos. |

## Riscos

1. **Compatibilidade aberta.** Um token sem perfil reconhecido lê tudo da filial. Fechar isso, com acesso
   negado por padrão, depende da GMill confirmar os perfis. É **decisão do maestro**, apontada no checkpoint.
2. Os nomes dos perfis são palpite. Eles ficam em constantes, para trocar sem mexer em regra.

## Fora do escopo

Tela (E9) e arquivo (E10).

## 📋 Phase-Subtask Mapping
- **Phase 1**: "Ligação login × vendedor, serviço de visibilidade e restrição das leituras" → Subtask ID: 2723266000000151016
- **Phase 2**: "API, smoke, docs e revisão" → Subtask ID: 2723266000000151016
