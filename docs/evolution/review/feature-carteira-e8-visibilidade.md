---
reviewed_diff_sha256: n/a (revisão de main...3fd0369 + rotas da fase 2; correções em 14a79a6)
findings_total: 7
findings_real: 7
tokens: 520000
duration_min: 55
verdict: APROVADO
elenxo: sim
nota: >
  Conduzido com /meta:drive E8–E10. A revisão foi ADVERSARIAL de segurança (default reprovado na
  dúvida, uma sonda por tentativa), com um @branch-code-reviewer só leitura. Veredito APROVADO: nenhum
  vazamento explorável em dezenas de tentativas como vendedor, gestor e supervisão. O risco Alto do
  modo legacy, já registrado como decisão do maestro, foi confirmado com evidência. Ganhou mecanismo
  (VISIBILITY_LEGACY) e a recusa de papel quase-conhecido. O padrão segue para o maestro decidir.
---

# Resíduo — `feature/carteira-e8-visibilidade`

| # | sev. | achado | destino |
|---|---|---|---|
| 1 | ALTA (risco de configuração) | Papel com outra grafia (`Admin`, ` admin`, `Vendedor`) ou desconhecido cai em legacy e lê a filial inteira. Não há escalada de escrita, e o vendedor não provoca o caso sozinho. | Mecanismo `VISIBILITY_LEGACY=allow\|deny` e **403 para papel que só difere por caixa ou espaço**, em todos os serviços. **O padrão (`allow`) é decisão do maestro antes de produção.** |
| 2 | MÉDIA | `check` e `/me/customers` usavam uma regra ampla diferente da do GET do E2 (vínculo inativo). | Regra única: vínculo ativo ou não. |
| 3 | BAIXA | A fonte de vendedor e gestor confiava só em `portfolio_links.active`. | Exige cliente ativo e vínculo ativo na filial. |
| 4 | BAIXA | As escritas revelavam a existência da carteira (403 × 404). | 404 para quem não lê. |
| 5 | BAIXA | O vendedor que atua na carteira via contagens agregadas da carteira inteira. | Omitidas para quem não tem leitura ampla nem é responsável. |
| 6 | BAIXA | `summary.seller` sem escopo de filial. | Curado. |
| 7 | INFO | O volume não cobria o `customers.list` restrito. | Incluído no `test:perf` (50 mil, teto de 300 ms). |

**Desempenho medido:** página do vendedor em cerca de 40 ms; `check` com 1.000 ids em cerca de 6 a 14 ms;
`customers.list` restrito com 50 mil clientes em cerca de 20 ms; gestor com 50 mil em cerca de 92 ms.
