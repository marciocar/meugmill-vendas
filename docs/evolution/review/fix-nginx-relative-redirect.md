---
reviewed_diff_sha256: n/a (uma diretiva de nginx e uma checagem de smoke)
findings_total: 1
findings_real: 1
tokens: 5000
duration_min: 5
verdict: CORRIGIDO
elenxo: nao
nota: >
  Achado no primeiro uso real do domínio da GMill pela sessão do core (onion-evolve): o nginx da imagem web devolvia
  redirect absoluto com a porta interna (`Location: http://gmill.onionevolve.com:8080/demo/index.html`). O core
  contornou no Caddy (header_down); esta é a cura de raiz. Mudança de uma linha, sem revisão adversarial dedicada:
  o comportamento foi medido antes e depois.
---

# Resíduo — `fix/nginx-relative-redirect`

| #   | sev.  | achado                                                                                                 | destino                                                                                                                                       |
| --- | ----- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MÉDIA | Redirect de `/` e de `/docs` saía absoluto com a porta 8080 do container, inalcançável atrás de proxy. | `absolute_redirect off;` no nginx (antes `http://localhost:8080/demo/index.html`, agora `/demo/index.html`) e checagem no `scripts/smoke.sh`. |
