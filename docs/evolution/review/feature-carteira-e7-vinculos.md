---
reviewed_diff_sha256: n/a (revisão de feature/carteira-e6-distribuicao...3bceeff; correções em ef81850)
findings_total: 8
findings_real: 8
tokens: 420000
duration_min: 50
verdict: REPROVADO_E_CURADO
elenxo: sim
nota: >
  Conduzido com /meta:drive E5–E7. Um @branch-code-reviewer independente, só leitura, com sondas,
  revisou só o que o E7 acrescenta. Semáforo amarelo, com um achado ALTO reproduzido: a transferência
  de filial deixava vínculos presos na filial antiga. Ao corrigir, o orquestrador também REVIU uma
  decisão [auto] própria. A decisão era não encerrar vínculos de outra carteira, e o revisor mostrou
  que ela travava a carteira vencedora. A nova regra é a tomada de vínculo, justificada pela regra
  do E5. Todos os achados foram curados, menos a retenção da outbox, registrada como dívida.
---

# Resíduo — `feature/carteira-e7-vinculos`

| # | sev. | achado | destino |
|---|---|---|---|
| 1 | ALTA | Transferir uma carteira finalizada de filial deixava os vínculos ativos na filial antiga. O `link_conflict` de outra carteira vazava o id dela, a outbox da filial nova ficava sem eventos, e re-finalizar não resolvia. Reproduzido. | Curado (`ef81850`): a transferência encerra os vínculos e volta a `draft`; defesa no diff do `finalize`. |
| 2 | MÉDIA | O `link_conflict` podia travar a carteira vencedora (a outra incompleta, bloqueada ou sem permissão do responsável). | Curado: **tomada de vínculo** (`takenOver`), encerrando o vínculo da carteira que perdeu a disputa, com evento e versão. `link_conflict` ficou só como fail-closed. **Reviu a decisão [auto] anterior.** |
| 3 | MÉDIA | Inativar e reativar deixava `status: active` sem nenhum vínculo. | Curado: inativar volta a `draft`. |
| 4 | MÉDIA | Vínculos ficavam ativos depois que cliente, vendedor ou filial eram inativados ou desvinculados, sem evento. | Curado: `endLinksWhere` nos serviços do E2, com eventos. |
| 5 | MÉDIA | O histórico ordenava tudo a cada página (TEMP B-TREE). | Curado: índices (migration 0010), EXPLAIN sem TEMP B-TREE. |
| 6 | BAIXA (teste) | O teste da outbox com duas filiais só tinha eventos de uma delas. | Curado: intercaladas, com `limit` 1, 2, 5 e 7. |
| 7 | BAIXA | A outbox não tem retenção. | **Dívida registrada** (expurgo ou cursor mínimo confirmado). |
| 8 | BAIXA | Era possível finalizar carteira de filial inativa. | Curado: 400. A carteira vazia continua finalizável, como está documentado. |

**Volume** (50 mil × 3 subgrupos × 10 vendedores): a 1ª finalização com 150 mil vínculos e 150 mil
eventos leva cerca de 1,4 s; a re-finalização com 1% de trocas, cerca de 0,95 s; listagens e outbox, em
ms. O `test:perf` passou com 26 testes.
