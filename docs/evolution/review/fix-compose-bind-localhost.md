---
reviewed_diff_sha256: n/a (mudança de 3 linhas em compose.yaml)
findings_total: 0
findings_real: 0
tokens: 0
duration_min: 2
verdict: SEM_ACHADOS
elenxo: nao
nota: >
  Correção de infraestrutura de um arquivo, motivada por um achado de segurança medido (`ss -ltn`
  mostrava 0.0.0.0). A checagem própria foi medir o efeito: depois da mudança, `ss` mostra só
  127.0.0.1 nas três portas, o smoke passa, e o maestro testou a demo pelo túnel SSH. Não houve
  revisor independente.
---

# Resíduo — `fix/compose-bind-localhost`

| Verificação | Comando | Resultado |
|---|---|---|
| Portas antes | `ss -ltn` | `0.0.0.0:3000`, `0.0.0.0:8080`, `0.0.0.0:8081` (expostas) |
| Portas depois | `ss -ltn` | `127.0.0.1:3000`, `127.0.0.1:8080`, `127.0.0.1:8081` |
| Compose válido | `docker compose config -q` | ok |
| Stack funcional | `bash scripts/smoke.sh` | verde |
