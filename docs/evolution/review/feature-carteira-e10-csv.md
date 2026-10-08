---
reviewed_diff_sha256: n/a (3 passadas: main...0e8dc12, eee6a82 e 2cc055d; correções finais no HEAD do PR)
findings_total: 18
findings_real: 18
tokens: 600000
duration_min: 120
verdict: APROVADO
elenxo: sim
nota: >
  Conduzido com /meta:drive E8–E10. A revisão foi ADVERSARIAL (default reprovado na dúvida), feita por um
  @branch-code-reviewer só leitura, em 3 passadas. A 1ª REPROVOU: nenhuma escalada nem vazamento, mas 5
  achados MÉDIOS quebravam promessas do contrato. A 2ª REPROVOU por uma regressão MÉDIA que a correção 2
  criou: carteira desfeita aparecia como gravada. A 3ª APROVOU, com uma ressalva BAIXA (N9), corrigida antes
  do PR. O smoke no Compose pegou um defeito que os testes com banco em memória não pegavam: a cópia de um
  banco WAL.
---

# Resíduo — `feature/carteira-e10-csv`

## 1ª passada (REPROVADO)

| # | sev. | achado | destino |
|---|---|---|---|
| 1 | MÉDIA | A simulação desfazia cada bloco separadamente, então um bloco não via o anterior. Resultado: `version_conflict` falso e gravação parcial. | Simulação cumulativa numa cópia do banco. |
| 2 | MÉDIA | A confirmação com um token de escopo maior gravava `update` onde a simulação dizia `linked`. | Mesmo escopo de token exigido; ação ou ativação diferente da simulada falha com `changed_since_validation`. |
| 3 | MÉDIA (LGPD) | A simulação vencida mantinha o arquivo até alguém ler o job. | O arquivo fica só na memória; varredura a cada 10 min e a cada envio. |
| 4 | MÉDIA (DoS) | Bloqueios de 2 a 3,4 s (parse, campo gigante, pré-validação). | Leitor incremental com cessão de vez; campo gigante recusado durante a leitura. Carteira grande nos vínculos documentada (mesmo custo do E7). |
| 5 | MÉDIA | `\|` num bairro ou código corrompia a ida e volta. | O domínio recusa `\|` e `:`; a exportação falha em vez de gerar arquivo ambíguo. |
| 6 | BAIXA | `linked` ignorava `ativo=N`. | O `N` passa a inativar o vínculo novo; a reimportação com dados diferentes está documentada. |
| 7 | BAIXA | A API lia 16 MB do corpo antes de responder 403. | Admin conferido no `onRequest`; parser só na rota de envio. |
| 8 | BAIXA | Oráculo de existência na simulação. | Filial conferida no token antes da busca; mesma mensagem do E6 para inexistente e não membro. |
| 9 | BAIXA | O relatório da gravação ficava fora da transação dos dados. | Mesma transação. |
| 10 | BAIXA | Valor com `'` + fórmula perdia o apóstrofo na volta. | A saída sempre acrescenta um `'` e a entrada tira um. |

## 2ª passada (REPROVADO)

| # | sev. | achado | destino |
|---|---|---|---|
| N1 | MÉDIA | Carteira desfeita por `changed_since_validation` deixava as outras linhas como `applied`. | Todas as linhas da unidade falham. |
| N2 | BAIXA | O sentinela único de CNPJ inexistente reabria o oráculo pela célula repetida. | Sentinela por linha. |
| N3 | BAIXA/MÉDIA | O `serialize` bloqueava a API em proporção ao tamanho do banco (461 ms com 152 MB). | `backup` assíncrono por páginas (99 ms com 152 MB). |
| N4 | BAIXA | A fatia de leitura era contada em caracteres. | Também por registros (17 ms com 16 MB de linhas vazias). |
| N5 | BAIXA | Parar no meio da gravação marcava `interrupted` mesmo com dados gravados. | `partially_applied` quando alguma linha já foi gravada. |
| N6 | BAIXA | A regra nova de código não trata dados antigos. | **Risco documentado**: conferir antes da carga inicial (ainda não há dado de produção). |
| N7 | BAIXA | Poucos admins esgotavam o teto global de memória. | 48 MB por usuário e 256 MB no total. |
| N8 | INFO | A migração 0012 foi editada antes do merge. | Recriar volumes de desenvolvimento que aplicaram a versão antiga. |

## 3ª passada (APROVADO)

| # | sev. | achado | destino |
|---|---|---|---|
| N9 | BAIXA (LGPD) | Um processo morto deixava a cópia do banco em `/tmp`. | A cópia agora fica em `import-sim/`, ao lado do banco (mesmo volume e mesma retenção), e é apagada na subida. A 1ª tentativa limpava o `/tmp` compartilhado e apagou cópias de outras instâncias; a suíte pegou e o desenho foi trocado. |
| — | INFO | `partial` contava linhas processadas, não gravadas. | Agora conta linhas gravadas. |

**Medido (50 mil clientes):** simulação e gravação em cerca de 1 min cada; atraso do event loop com p99 de
cerca de 90 ms; máximo isolado entre 260 e 570 ms, que é um bloco somado a pausa de GC.
