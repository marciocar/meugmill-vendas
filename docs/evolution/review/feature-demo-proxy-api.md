---
reviewed_diff_sha256: n/a (nginx, compose, demo, vite e smoke)
findings_total: 1
findings_real: 1
tokens: 0
duration_min: 5
verdict: CORRIGIDO
elenxo: nao
nota: >
  Checagem própria, medida no Compose local; não houve revisor independente. Um achado na própria
  redação: o smoke comparava a origem do CORS com ${WEB_URL} dentro de aspas simples (sem expansão),
  o que faria o preflight falhar sempre. Foi corrigido para aspas duplas antes do commit.
---

# Resíduo — `feature/demo-proxy-api`

| Verificação | Comando | Resultado |
|---|---|---|
| Portas novas só em loopback | `ss -ltn` | `127.0.0.1:39000`, `127.0.0.1:39080`, `127.0.0.1:39081`; portas antigas fechadas |
| Proxy /api | `scripts/smoke.sh` | `/api/health` 200 e `/api/v1/me` 200 com token, via nginx |
| Restante do smoke | `scripts/smoke.sh` | health, ready, 401, token, CORS (com origem 39081) e bundle: verdes |
| Web | `pnpm --filter @meugmill/web test` + eslint | 22 testes, lint ok |
