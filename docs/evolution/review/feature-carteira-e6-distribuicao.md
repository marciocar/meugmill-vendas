---
reviewed_diff_sha256: n/a (revisão de feature/carteira-e5-conflitos...edbe8ca; correções em 1f1bb45)
findings_total: 9
findings_real: 9
tokens: 330000
duration_min: 35
verdict: CORRIGIDO
elenxo: sim
nota: >
  Conduzido com /meta:drive E5–E7. Um @branch-code-reviewer independente, só leitura, com sondas,
  revisou só o que o E6 acrescenta sobre o E5. Semáforo amarelo, sem achado alto: as invariantes se
  confirmam, e os membros efetivos são lidos dentro da transação de escrita. Os médios foram decididos
  pelo orquestrador seguindo o risco já aceito no E5 (sem cache agora) e curados com os baixos. O
  orquestrador também achou que o finalCounts sumia da resposta (o Fastify descarta campos fora do
  schema) e corrigiu a rota com um teste.
---

# Resíduo — `feature/carteira-e6-distribuicao`

| # | sev. | achado | destino |
|---|---|---|---|
| 1 | MÉDIA | Cada página da listagem refaz a disputa do E5 (0,23–0,35 s de CPU bloqueada por página). Percorrer a grade inteira por páginas seria quadrático. | Sem cache agora, coerente com o risco aceito no E5. Criada a `loadAssignmentGrid` (grade inteira sem paginação) para o E7. |
| 2 | MÉDIA/BAIXA | O equilíbrio só vale partindo do zero, e o contrato não avisava. | Documentado ("só sobre o que falta"); `distribute` devolve `finalCounts`. |
| 3 | BAIXA | A regra de validade estava escrita duas vezes. | `isValidAssignment` deriva de `invalidReason`. |
| 4 | BAIXA | As leituras da listagem e do resumo ficavam fora de uma transação. | Transação de leitura. |
| 5 | BAIXA | O erro do `set` não apontava o item. | `set[i]: …`, sem eco. |
| 6 | BAIXA | As chaves de vendedor e subgrupo não tinham índice. | Migration `0008`. |
| 7 | BAIXA | `distribute` sem nada a fazer mudava a versão. | Só incrementa quando grava; o ETag fica igual. |
| 8 | BAIXA (teste) | O teste "clear remove inclusive stale" não criava célula stale. | Corrigido. |
| 9 | BAIXA (teste) | Faltava teste de escopo do `set` com cliente existente de outra filial. | Corrigido, também com vínculo inativo. |

**Achado do orquestrador na integração:** o `finalCounts` sumia da resposta HTTP, porque o Fastify
remove campos fora do schema de resposta. Corrigido na rota, com um teste de rota.

**Volume:** com 50 mil × 3 subgrupos × 10 vendedores, `distribute` do zero leva cerca de 0,74 s (150 mil
linhas), uma página até 0,35 s e o resumo até 0,43 s. O `test:perf` passou 3 vezes seguidas, depois de
uma falha única logo após a suíte completa, com a máquina carregada.
