# Contexto — carteira-e7-vinculos

- **Branch**: feature/carteira-e7-vinculos (**empilhada sobre** `feature/carteira-e6-distribuicao`)
- **Task vinculada**: OG1-T8 · `2723266000000144091` (zoho) — E7; 8 story points
- **Criada em**: 2026-10-08 · **Condução**: `/meta:drive` E5–E7 (aprovações automáticas; merge humano em lote)
- **Objetivo**: finalizar a carteira, gravando os **vínculos** carteira × cliente × subgrupo × vendedor a
  partir das atribuições válidas do E6, com histórico. Na re-finalização, comparar com os vínculos atuais:
  os removidos deixam de ficar ativos e os novos são criados. Os eventos de mudança ficam numa **outbox**
  para o sistema principal.

## Regra (documento)

"Ao finalizar, o MeuGmill grava os vínculos entre carteira, cliente, vendedor e subgrupo. Ao editar uma
carteira, o sistema compara as atribuições atuais com a lista revisada: vínculos removidos da lista
deixam de ficar ativos, e novos vínculos são criados."

## Decisões [auto] — orquestrador, 2026-10-08

| Tema | Decisão | Por quê |
|---|---|---|
| Finalizar | `POST /v1/portfolios/{id}/finalize` com `If-Match`, permissão de edição do E3 e carteira não inativa. Lê a grade com `loadAssignmentGrid` **dentro** da transação, grava os vínculos, muda `status` para `active` e incrementa a versão. | Fecha o ciclo do wizard (decisão do E3: ativação só no E7). |
| Completude | Finaliza só se **toda** célula da grade (membro efetivo × subgrupo da carteira) tiver vendedor válido. Senão, 409 `portfolio_incomplete`, com as contagens `unassigned` e `stale`. | Um vínculo pela metade deixaria clientes sem atendimento num subgrupo. |
| Conflitos pendentes | Se a carteira tiver clientes **`blocked`** (E5), a finalização é recusada com 409 `portfolio_has_conflicts`. | O documento manda a equipe revisar o conflito. Finalizar por cima esconderia a disputa. |
| Diff | Para cada (cliente, subgrupo): mesmo vendedor, mantém; vendedor diferente, encerra o antigo e cria o novo; saiu da grade, encerra; entrou, cria. Tudo numa transação. | É a regra do documento, com histórico. |
| Histórico | Tabela `portfolio_links` com `active`, `valid_from`, `valid_to`, `created_by` e `ended_by`. O vínculo encerrado **nunca é apagado**. | Auditoria e LGPD: rastreabilidade de quem atendia quem e quando. |
| Unicidade entre carteiras (REVISTA após a revisão: tomada de vínculo, ver resíduo) | Índice único **parcial**: (filial, cliente, subgrupo) **onde ativo**. Se outra carteira da filial ainda tiver vínculo ativo para a mesma célula (ela foi finalizada quando ainda vencia a disputa), a finalização é recusada com 409 `link_conflict`, que lista as carteiras a re-finalizar. | Não encerra silenciosamente os vínculos de outra carteira. Re-finalizar a outra encerra os dela, porque o cliente saiu da grade dela. |
| Inativar carteira ativa | A inativação do E3 passa a **encerrar todos os vínculos ativos** da carteira, com eventos, na mesma transação. Reativar **não** recria vínculos: é preciso finalizar de novo. | Uma carteira inativa não pode manter clientes presos a ela. |
| Outbox | Tabela `portfolio_link_events` (id crescente, `kind` = `created`\|`ended`, vínculo, filial, cliente, subgrupo, vendedor, instante), gravada na **mesma transação**. A leitura é por `GET /v1/link-events?branchId=&after=&limit=`, escopada pelas filiais do token. | Decisões de trabalho: API síncrona primeiro, eventos via outbox. O sistema principal consome por cursor, sem precisar de fila. |
| Leitura dos vínculos | `GET /v1/portfolios/{id}/links` (ativos, filtros subgrupo e vendedor, cursor) e `GET /v1/portfolios/{id}/links/history` (inclui os encerrados). | Para a tela e para o E8. |
| Desempenho | Meta: 50 mil × 3 subgrupos = 150 mil vínculos mais 150 mil eventos na 1ª finalização, em ≤ 5 s. A re-finalização com poucas mudanças deve ficar em ≤ 2 s. Medido no `test:perf`. | É escrita em massa síncrona. |

## Fora do escopo

A visibilidade por perfil (E8) usa os vínculos ativos, mas não é implementada aqui. Tela (E9) e arquivo (E10).

## 📋 Phase-Subtask Mapping
- **Phase 1**: "Vínculos, finalização, histórico e outbox (domínio)" → Subtask ID: 2723266000000144091
- **Phase 2**: "API, smoke, docs e revisão" → Subtask ID: 2723266000000144091
