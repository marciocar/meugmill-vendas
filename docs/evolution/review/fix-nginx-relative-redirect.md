---
reviewed_diff_sha256: n/a (uma diretiva de nginx e uma checagem de smoke)
findings_total: 2
findings_real: 2
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

| #   | sev.  | achado                                                                                                                                                                                                                                                       | destino                                                                                                                                                      |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | MÉDIA | Redirect de `/` e de `/docs` saía absoluto com a porta 8080 do container, inalcançável atrás de proxy.                                                                                                                                                       | `absolute_redirect off;` no nginx (antes `http://localhost:8080/demo/index.html`, agora `/demo/index.html`) e checagem no `scripts/smoke.sh`.                |
| 2   | MÉDIA | A senha Basic do domínio chegava ao IdP de teste, que a lia como o cliente OAuth e devolvia o perfil padrão (vendedor da `filial-01`) em silêncio: a demo abria "sem dados". Achado pela sessão do core, que corrigiu no Caddy (`header_up -Authorization`). | A demo e a referência da API passam a mostrar o login do token recebido; a demo avisa quando ele não é o pedido. Testado no navegador interceptando o token. |
