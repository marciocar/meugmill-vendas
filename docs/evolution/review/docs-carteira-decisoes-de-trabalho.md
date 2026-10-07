---
reviewed_diff_sha256: 22f2ef4812294742ac6a3f38a0cc5b35a2304443251017ded4ef30b2bd6ff6d1
findings_total: 0
findings_real: 0
tokens: 0
duration_min: 3
verdict: SEM_ACHADOS
elenxo: nao
nota: >
  PR só de documentação, então a passada adversarial completa foi dispensada pelo corte do /engineer:pr
  (espera curta, sem código). Houve uma checagem própria das afirmações do documento que citam o
  código, cada uma conferida com grep no main...HEAD. Não houve revisor independente.
---

# Resíduo — `docs/carteira-decisoes-de-trabalho`

| Afirmação do documento | Conferido | Resultado |
|---|---|---|
| Claims trocáveis por `OIDC_CLAIM_ROLES`/`OIDC_CLAIM_BRANCHES` | `grep` em `apps/api/src/config.ts` | Presentes |
| Issuer e audience por `OIDC_ISSUER`/`OIDC_AUDIENCE` | `grep` em `config.ts` | Presentes; a API não sobe sem eles |
| Dev usa a origem `http://localhost:8081` | `grep` em `compose.yaml` | `CORS_ORIGINS` com default `http://localhost:8081` |
| `typ: at+jwt` ainda "pendente" | `grep -w typ` e `at+jwt` em `apps/api/src` | Nenhuma ocorrência: de fato pendente |
| Doc de LGPD citado existe | `ls docs/technical-context/lgpd-minimizacao.md` | Existe |

As decisões em si são da equipe e não foram confirmadas pelo cliente. O documento declara isso no topo e marca cada item.
