---
reviewed_diff_sha256: n/a (revisão sobre main...57d97ed; correções em 90d5ee5 e 25d2eb4)
findings_total: 8
findings_real: 8
tokens: 420000
duration_min: 35
verdict: REPROVADO_E_CURADO
elenxo: sim
nota: >
  Conduzido com /meta:drive e aprovações automáticas do orquestrador (autorizadas pelo maestro). Houve
  três passadas independentes, todas só leitura: @branch-code-reviewer (diff),
  @branch-test-planner (cobertura) e uma verificação ADVERSARIAL de confirmação, com mandato de refutar
  e default reprovado, sobre a correção do achado alto. A revisão achou e reproduziu um vazamento
  ALTO de escopo. Os testes de regressão falharam no código antigo, e a verificação adversarial aprovou
  a correção depois de seis sondas. Os resíduos dela (órfãos) também foram curados.
---

# Resíduo — `feature/carteira-e4-elegibilidade`

| # | sev. | achado | destino |
|---|---|---|---|
| 1 | ALTA | Os ajustes validavam o cliente contra as filiais do **ator**, não contra a filial da **carteira**, e o `GET /overrides` devolvia CNPJ e razão social a qualquer leitor. A troca de filial carregava ajustes de clientes alheios. Os dois cenários foram reproduzidos. | Curado (`90d5ee5`): vínculo com a filial da carteira obrigatório, troca recusada com ajuste incompatível, listagem filtrada. Os 4 testes de regressão falhavam antes. |
| 2 | MÉDIA | O teste do limite de 5.000 usava ids inexistentes e passaria sem o limite. | Curado: clientes reais, no domínio e via HTTP. |
| 3 | BAIXA | Um teste com nome enganoso ("cliente da filial CAR passa...") usava um cliente das duas filiais. | Curado: substituído pelo caso negativo. |
| 4 | BAIXA | Inclusão manual saía com o nível de região que casou só em parte, o que daria prioridade indevida no E5. | Curado: `matchedRegionLevel = null` para `manual`. |
| 5 | BAIXA | Incluir um cliente que já casa o filtro era aceito sem aviso. | Documentado `[auto]` (aparece como `filter`). |
| 6 | BAIXA (adversarial R1) | As contagens do agregado incluíam ajustes órfãos invisíveis. | Curado (`25d2eb4`): contam só os vinculados à filial da carteira. |
| 7 | BAIXA (adversarial R2) | Um órfão bloqueava a troca de filial com um erro inexplicável. | Curado: a troca descarta os órfãos na mesma transação. |
| 8 | BAIXA (adversarial R3) | Um teste afirmava que o órfão era "impossível pela API". Era falso, porque editar os vínculos do cliente o cria. | Curado: o teste cria o órfão pela API de clientes. |

**Desempenho medido** (motor e revisor): com 50 mil clientes, a primeira página com total leva cerca de
165 ms; a carteira que não casa nada (pior caso) leva cerca de 62 ms; `eligibilityOf` com 5.000 ids leva
cerca de 51 ms. O plano faz `SCAN` em `customers` por PK, o que é um risco declarado para volumes muito
maiores.

**Lacunas cobertas:** três critérios juntos, região mista, prévia sem cache, paginação com ajustes
intercalados, soma das páginas = total, versão compartilhada E3/E4.

**NÃO MEDIDO:** ajustes gravados antes da correção num banco real. O E4 nunca foi implantado fora de
dev e smoke, e os órfãos de qualquer forma deixam de aparecer e de contar.
