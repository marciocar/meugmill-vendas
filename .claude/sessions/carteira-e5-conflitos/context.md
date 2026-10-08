# Contexto — carteira-e5-conflitos

- **Branch**: feature/carteira-e5-conflitos (base: main `cf375b4`)
- **Task vinculada**: OG1-T6 · `2723266000000149033` (zoho) — E5; 5 story points
- **Criada em**: 2026-10-08
- **Condução**: `/meta:drive` E5–E7 com aprovações automáticas do orquestrador; branches empilhadas
  (E6 sai do E5, E7 sai do E6); merge humano em lote.
- **Objetivo**: resolver a disputa de um cliente entre carteiras da mesma filial pela correspondência
  mais específica, bloqueando o cliente nas duas prévias quando houver empate.

## Regra de negócio (documento)

"Se duas carteiras da mesma filial alcançarem o mesmo cliente, o sistema considera a correspondência
mais específica: 1. Grupo econômico; 2. Rede; 3. Região por bairro; 4. Região por cidade; 5. Região por
estado. [...] Se duas carteiras tiverem a mesma prioridade para um cliente, esse cliente fica bloqueado
nas duas prévias para que a equipe revise o conflito."

## Decisões [auto] — orquestrador, 2026-10-08

| Tema | Decisão | Por quê |
|---|---|---|
| Força da correspondência | É o **maior** posto entre os critérios que **casaram** o cliente naquela carteira: grupo econômico = 5, rede = 4, bairro = 3, cidade = 2, estado = 1. | "Correspondência mais específica". Uma carteira de região E rede que casa os dois vale pela rede. |
| Inclusão manual | **Posto 6**, acima de qualquer filtro. Duas carteiras que incluem o mesmo cliente manualmente empatam e o bloqueiam. | É uma decisão explícita de alguém. |
| Exclusão manual | O cliente **não concorre** naquela carteira. | Ele foi tirado de propósito. |
| Quem concorre | As carteiras **não inativas** da mesma filial, em **rascunho ou ativas**. | Um rascunho em revisão também disputa o cliente, e a disputa aparece justamente na revisão. A carteira inativa não disputa. |
| Resultado por cliente, em cada carteira | `assigned` (venceu ou não tem disputa), `lost` (outra carteira tem posto maior) ou `blocked` (empate no maior posto). | Usa a linguagem do documento: o cliente fica bloqueado nas duas prévias. |
| Prévia | Cada item ganha `resolution` e `competitors` (carteiras concorrentes: id, nome e posto), com filtro `resolution`. O total respeita esse filtro. | Para a equipe revisar o conflito na própria prévia. Só aparecem as carteiras que o leitor pode ver (mesma filial do token). |
| Membros efetivos | Só `assigned` segue para distribuição (E6) e vínculo (E7). | `lost` pertence a outra carteira, e `blocked` exige revisão. |
| Desempenho | Meta de 50 mil clientes com 20 carteiras na filial. Medir com volume sintético e um teto no teste. | O cálculo cresce com o número de carteiras. |

## Fora do escopo

Distribuição (E6), finalização e vínculos (E7). Uma tela de "painel de conflitos" da filial fica para
o E9. Os conflitos ficam visíveis pela prévia de cada carteira.

## 📋 Phase-Subtask Mapping
- **Phase 1**: "Motor de conflitos e prévia com resolução" → Subtask ID: 2723266000000149033
- **Phase 2**: "API, smoke, docs e revisão" → Subtask ID: 2723266000000149033
