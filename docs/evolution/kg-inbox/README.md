# Fila de propostas ao grafo (kg-inbox)

Quem NÃO é dono do grafo **propõe** aqui (`<slug>.proposal.kg.yaml`; se souber o grafo de destino,
declare-o em `meta.target`); o **dono sela** com `/meta:kg-inbox` — que roteia por papel e, num repo
adotado, sela esta fila local. Aceita vai por `append` no grafo-alvo e a proposta migra para `_sealed/`;
recusada vai para `_rejected/` com o motivo num arquivo irmão. O gate de selagem é `kg-radar` exit 0 no
ALVO.

**O grafo-alvo tem de ser um grafo DESTE repo** (`git ls-files '*.kg.yaml'`) — um escritor por repo.
Conhecimento que mora noutro repo não se sela aqui: é rejeitado com o motivo, e o gap vira nó `open`.

**Uma proposta é FRAGMENTO, não grafo fechado.** Por isso o radar entra em MODO PROPOSTA quando o
arquivo declara `meta.target` ou termina em `.proposal.kg.yaml`: ele deixa de exigir grau ≥ 1 e de
resolver aresta para fora do arquivo — e **conta** o que relaxou. Todo o resto (id duplicado,
`node_type`, `plane`, `status`, `impact`, `confidence`, `edge_type`) continua reprovando. Sem isso a
proposta de UM nó que este README manda escrever nunca passaria: reprovava com `nó órfão (grau 0)`.
O relaxamento acaba na SELAGEM, onde o grafo volta a ser fechado.

```yaml
meta:
  schema_version: "1"
  target: docs/onion/graph/<o-grafo-vivo>.kg.yaml
nodes:
  - id: P_O_QUE_EU_PROPONHO
    node_type: claim
    plane: DEV
    status: open
    impact: 3
    confidence: 0.8
    label: "A afirmação proposta, em uma frase que se possa refutar."
edges: []
```
