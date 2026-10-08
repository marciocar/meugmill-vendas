---
reviewed_diff_sha256: n/a (revisão sobre main...4f2d115; correções em 632a925)
findings_total: 9
findings_real: 9
tokens: 340000
duration_min: 20
verdict: CORRIGIDO
elenxo: sim
nota: >
  Passada pré-PR com dois agentes independentes, só leitura: @branch-code-reviewer (autorização por
  dono, integridade, escopo, LGPD, contrato) e @branch-test-planner (cobertura). Nenhum achado alto.
  Os dois médios foram decididos pelo orquestrador seguindo os padrões já aprovados (soft delete =
  abandono; chave própria por cadastro) e declarados ao maestro. Todos os achados foram curados neste
  PR, e as lacunas viraram testes (de 366 para 395).
---

# Resíduo — `feature/carteira-e3-cadastro-carteira`

| # | sev. | achado | destino |
|---|---|---|---|
| 1 | MÉDIA | A arquitetura prometia que "Norte — Farmácias" e "NORTE - FARMACIAS" colidem, mas a chave do E2 não normaliza pontuação, e o teste usava o mesmo travessão nas duas grafias. | Curado (`632a925`): chave `portfolioNameKey` própria da carteira, recalculada no boot. A arquitetura foi corrigida. |
| 2 | MÉDIA | Carteira inativa continuava editável, e a reativação não revalidava nada. | Curado: 409 `portfolio_inactive`; reativar revalida filial e tipo. |
| 3 | BAIXA | A troca de filial não exigia vendedor ativo globalmente (o PUT exigia). | Curado: `assertSellersUsable` nos dois caminhos. |
| 4 | BAIXA | O `responsibleSub` colapsava espaços internos de um `sub` opaco. | Curado: só `trim`, inclusive no filtro da lista. |
| 5 | BAIXA | `assertBranchesActive` não tinha teste. | Curado. |
| 6 | BAIXA | Faltava teste do responsável sem a filial no token (deve receber 404). | Curado. |
| 7 | BAIXA | O teste "troca como admin das duas filiais" não trocava de fato. | Curado: agora troca e confere o ETag. |
| 8 | BAIXA | O teste de `branchId` + `q` não conferia os itens, e o laço de 404 não incluía `deactivate`. | Curado. |
| 9 | BAIXA | O responsável que trocava a filial com versão velha recebia 409 em vez de 403. | Curado: a permissão é decidida antes da versão. |

**Lacunas do planejador cobertas:** bairro com acento e caixa ("São Torquato" × "SAO TORQUATO"), o
mesmo bairro em município diferente, bairro só com pontuação, listagem com duas filiais, `active=false`
e `status` inválido via HTTP, limites nas bordas (500 e 200 válidos), isolamento entre seções do PUT,
falha no meio do PUT preservando tudo, e a idempotência da inativação com versão.

**Ficou para E4+:** ativação `draft → active` (E7), efeito retroativo da inativação de vendedor ou rede
sobre carteiras (decisão de produto, tratada no E6 e no E7) e carga com volume.
