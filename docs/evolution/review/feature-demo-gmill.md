---
reviewed_diff_sha256: n/a (1 passada sobre as mudanças da branch antes do 1º commit; correções no HEAD do PR)
findings_total: 10
findings_real: 10
tokens: 90000
duration_min: 6
verdict: REPROVADO_E_CURADO
elenxo: sim
nota: >
  Demonstração para a GMill (OG1-T12), conduzida com /meta:drive. Revisão ADVERSARIAL por um @branch-code-reviewer
  só leitura. Ele rodou o seed contra o Compose, conferiu os passos do roteiro contra a API e REPROVOU. Não achou
  nada bloqueante de segurança ou de dados: o problema era o roteiro prometer o que o seed não faz e a checagem de
  idempotência ter pontos cegos.
---

# Resíduo — `feature/demo-gmill`

| #   | sev.  | achado                                                                                                                 | destino                                                                                                                                    |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | MÉDIA | O roteiro prometia que o seed devolve a "situação" das carteiras; ele não desfaz finalização, atribuições nem ajustes. | Roteiro corrigido: o seed restaura cadastros, filtros e vendedores; depois de um ensaio, o ensaio do zero.                                 |
| 2   | MÉDIA | Com o IdP subido antes dos logins demo-*, o `demo-admin` caía no coringa e virava vendedor.                            | Roteiro com `--force-recreate idp`; o seed confere os claims do token e explica a correção.                                                |
| 3   | MÉDIA | O `--expect-unchanged` escrevia antes de conferir (vínculo login × vendedor, tipos, distribuir, finalizar).            | Com a flag, nenhuma escrita: falha antes; a carteira é conferida por situação, células e vínculos. Testado com uma mudança feita por fora. |
| 4   | BAIXA | Simulações podiam ficar abertas nos caminhos de erro (limite de 5 por usuário).                                        | Cancelamento conferido em todos os caminhos depois do envio.                                                                               |
| 5   | BAIXA | Erros de rede ou de API viravam stack trace.                                                                           | Mensagens em pt-BR; a saúde da API é conferida antes do token.                                                                             |
| 6   | BAIXA | O job `docker` do CI não instalava o Node do projeto.                                                                  | `actions/setup-node` com `.nvmrc`.                                                                                                         |
| 7   | BAIXA | Documentação técnica sem os logins demo-*.                                                                             | `api-visibilidade.md` e `front-web.md` atualizados.                                                                                        |
| 8   | BAIXA | Códigos de catálogo da demo são globais; colisão teórica de CNPJ com o smoke em 2029.                                  | **Risco documentado** no roteiro.                                                                                                          |
| 9   | INFO  | `withCode` com crase ímpar e dicionário sem teste.                                                                     | Testes novos. Sem risco de XSS (o React escapa).                                                                                           |
| 10  | INFO  | Log de sessão não deve entrar no commit.                                                                               | Fora do commit.                                                                                                                            |

**Achados do uso real nesta frente:**

- A captura para o deck mostrou crases literais no dicionário do CSV; corrigido com teste.
- A sessão do core mediu que o Basic puro do Caddy quebraria a demo, porque a tela manda `Authorization: Bearer`. Ela adotou um cookie depois do Basic.
- O seletor de token do Scalar não preenchia com a chave antiga da configuração; corrigido para `securitySchemes`.
