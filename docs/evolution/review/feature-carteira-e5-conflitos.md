---
reviewed_diff_sha256: n/a (revisão sobre main...f86bf5a; correções no commit seguinte)
findings_total: 6
findings_real: 6
tokens: 560000
duration_min: 60
verdict: REPROVADO_E_CURADO
elenxo: sim
nota: >
  Conduzido com /meta:drive E5–E7 (aprovações automáticas do orquestrador; merge humano em lote). Um
  @branch-code-reviewer independente, só leitura, com sondas reproduzindo cada achado, deu VERMELHO com
  dois achados ALTOS. Os dois foram curados e medidos. Um caso de estresse (100 carteiras sobrepostas)
  ficou acima do teto e foi levado ao maestro, que aceitou como risco registrado. A suíte também
  revelou um teste de tempo intermitente, corrigido na mesma passada.
---

# Resíduo — `feature/carteira-e5-conflitos`

| # | sev. | achado | destino |
|---|---|---|---|
| 1 | ALTA | Regressão do E4: `eligibilityOf` usava a lista de ids 7 vezes, com 500 por `too many SQL variables` acima de ~4.680 ajustes (o contrato aceita 5.000). Reproduzido contra a `main`. | Curado: os ids entram uma vez via `json_each`, com teste de 5.000 ajustes no PUT e no GET. |
| 2 | ALTA | Desempenho muito acima do teto na própria meta: 20 carteiras sobrepostas, 5,5 a 32 s, bloqueando o event loop. | Curado: a meta ficou em 0,75–0,8 s. O caso de 100 carteiras ficou em 2,3–2,6 s, **acima do teto e aceito pelo maestro** como risco, com cache por filial como melhoria futura. |
| 3 | MÉDIA | O teste de volume não media o pior caso, e as asserções eram quase tautológicas. | Curado: pior caso realista, conferido por contagem independente em JS. |
| 4 | BAIXA | Escrita confirmada podia devolver 5xx ao calcular as contagens depois do commit. | Curado: as contagens saíram das respostas de escrita (`?include=conflicts`). |
| 5 | BAIXA | As leituras da prévia não ficavam numa transação. | Curado na prévia. `getOverrides` não muda (processo síncrono único). |
| 6 | BAIXA | Dois testes não testavam o que diziam. | Curado. |

**Achado da própria condução:** com os tetos de tempo afirmados na suíte comum, o teste de volume
falhava sob contenção de CPU (a meta passava isolada). Os tempos agora são afirmados só no `test:perf`
isolado, e a conferência de resultado roda sempre.
