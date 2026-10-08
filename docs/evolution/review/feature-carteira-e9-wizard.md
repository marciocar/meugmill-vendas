---
reviewed_diff_sha256: n/a (3 passadas: main...6c7dd1d, 6c7dd1d..ff70f07 e ff70f07..a5d3d17; correções finais no HEAD do PR)
findings_total: 25
findings_real: 25
tokens: 450000
duration_min: 70
verdict: APROVADO
elenxo: sim
nota: >
  Conduzido com /meta:drive E8–E10 (último épico). A revisão foi ADVERSARIAL (default reprovado na dúvida),
  feita por um @branch-code-reviewer só leitura, em 3 passadas. A 1ª REPROVOU com dois achados ALTOS de
  perda de dados sem conflito: dados velhos enviados com a versão nova. A 2ª REPROVOU: a troca de aba
  descartava o wizard, e o erro do confirmar do CSV sumia. A 3ª APROVOU, com dois achados BAIXOS,
  corrigidos antes do PR. O teste da demo real num Chromium headless pegou um defeito de uso que os testes
  não pegavam: os concorrentes estouravam a tabela da prévia.
---

# Resíduo — `feature/carteira-e9-wizard`

## 1ª passada (REPROVADO)

| # | sev. | achado | destino |
|---|---|---|---|
| 1 | ALTA | Um segundo clique em ajustes, antes da releitura da lista, gravava o conjunto sem o ajuste anterior, com `If-Match` válido. | Só grava com a lista lida na versão atual; os botões ficam desabilitados durante a releitura. Teste que falha sem a correção. |
| 2 | ALTA | Depois de um 409, a etapa 1 mantinha os valores velhos e o próximo salvar revertia a gravação da outra pessoa. | A etapa recomeça da versão nova (`key`). Teste que falha sem a correção. |
| 3 | MÉDIA (LGPD) | Trocar o token para outro usuário cujo `/v1/me` falhasse deixava a tela do usuário anterior. | Só vale o `me` confirmado para o token atual; as telas ficam ocultas até confirmar. |
| 4 | MÉDIA | Inativar (encerra vínculos) com um clique. | Confirmação explícita; também para trocar a filial. |
| 5 | MÉDIA | Edição não salva descartada ao trocar de etapa. | Guarda de navegação. |
| 6 | MÉDIA | O acompanhamento do job parava na primeira falha. | Nova tentativa com espera crescente. |
| 7 | BAIXA | Uma leitura fora de ordem voltava a uma versão velha. | Ignora versão menor. |
| 8 | BAIXA | Um 401 de token já trocado emitia `token-expired`. | Ignorado. |
| 9 | BAIXA | Busca sem limite dava 400. | `maxLength` 100. |
| 10 | BAIXA | O botão de confirmar continuava depois do prazo. | A tela trava no prazo. |
| 11 | BAIXA | O token `legacy` não via a etapa 5. | Vê. |
| 12 | BAIXA | As listas de seleção cortam em 2.000 itens. | **Dívida** documentada. |
| 13 | INFO | O gestor responsável quase não acha cliente para incluir. | **Dívida** documentada. |
| 14 | INFO | O PUT de ajustes apaga os órfãos. | Documentado (conforme o contrato do E4). |
| 15 | MÉDIA | Testes quase só do caminho feliz. | Testes para cada modo de falha. |

## 2ª passada (REPROVADO)

| # | sev. | achado | destino |
|---|---|---|---|
| N1 | MÉDIA | Trocar de aba desmontava o wizard. | As abas visitadas ficam montadas. |
| N2 | MÉDIA | O erro do confirmar sumia na releitura. | Fica num estado próprio. |
| N3 | BAIXA | A busca de inclusão se perdia a cada inclusão. | Os botões ficam e só se desabilitam. |
| N4 | BAIXA | A primeira leitura do job não era tentada de novo. | É tentada. |
| N5 | BAIXA | Renovar o token do mesmo usuário com o `/v1/me` falhando desmonta as telas. | **Troca consciente**, documentada. |
| N6 | INFO | O prazo só era reavaliado ao redesenhar. | Reavaliado a cada 30 s. |

## 3ª passada (APROVADO)

| # | sev. | achado | destino |
|---|---|---|---|
| R1 | BAIXA | Uma aba mantida montada mostrava dado velho (carteiras importadas noutra aba). | A lista relê ao reexibir a aba. |
| R2 | BAIXA | A primeira leitura tentava de novo para sempre diante de 404 ou 401. | Só falha de rede e 5xx são tentadas de novo. |

**Teste no navegador real** (Chromium headless contra o Compose, `scratchpad/dogfood/e9.cjs`):
- admin cria a carteira pelas 5 etapas, distribui e finaliza;
- conflito de versão real (gravação por fora);
- exportação com download;
- importação simulada, confirmada e gravada;
- arquivo com erro;
- vendedor só lendo.
