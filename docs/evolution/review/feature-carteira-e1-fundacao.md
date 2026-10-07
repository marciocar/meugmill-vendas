---
reviewed_diff_sha256: 680b49807c0b2749a9ed7fe4ee903d1f4c7b5bad19f558930fb3be2de41d0b5d
findings_total: 11
findings_real: 11
tokens: 188000
duration_min: 15
verdict: CORRIGIDO
elenxo: sim
nota: >
  Passada pré-PR com dois agentes independentes, ambos só leitura: @branch-code-reviewer (lente
  maquinaria e segurança: auth, vazamento, CORS, Web Component, Docker, CI) e @branch-test-planner
  (lente cobertura: o teste prova o que diz?). A lente "pelo lado do adotante" não se aplica: o PR é
  produto, não framework. Dez achados foram curados neste PR (623ba1e, 6f0bb43), e um foi declarado
  como hipótese, com gatilho. Tokens somam os dois revisores e as duas frentes de correção. A
  duração é a parede da revisão mais a da correção em paralelo. O hash é do diff main...HEAD antes
  deste arquivo.
---

# Resíduo — `feature/carteira-e1-fundacao`

## Revisão do diff (@branch-code-reviewer)

Nenhum achado de severidade alta.

| # | sev. | achado | destino |
|---|---|---|---|
| 1 | MÉDIA | Issuer, JWKS e `jwks_uri` do discovery aceitavam `http:` em produção, o que permite trocar a JWKS no caminho de rede e falsificar tokens. | Curado (`623ba1e`): https obrigatório; `OIDC_ALLOW_INSECURE_HTTP=true` só no Compose de dev. Com testes. |
| 2 | MÉDIA | Um `token` ou `apiBase` setado antes do `customElements.define` virava propriedade própria e escondia o setter, e o componente ficava parado. | Curado (`6f0bb43`): lazy property upgrade. O teste cria o elemento antes do define. |
| 3 | MÉDIA | O 404 padrão do Fastify logava a URL com query, contornando o serializer, e um `?access_token=` ou `?cpf=` vazaria. | Curado (`623ba1e`): `setNotFoundHandler` sem query. O teste usa token e CPF na query. |
| 4 | MÉDIA | O smoke não esperava o IdP (JVM), o que daria CI intermitente. | Curado (`6f0bb43`): espera o discovery do IdP por até 90 s. |
| 5 | BAIXA/MÉDIA | "Simular token expirado" ia para o bundle de produção. | Curado (`6f0bb43`): só aparece com o atributo `debug`. |
| 6 | BAIXA | Nada separa access token de ID token (sem `typ: at+jwt`). | **Declarado**: hipótese `[INFERIDO]` em `carteira-de-clientes-hipoteses.md`. **Gatilho**: quando o IdP da GMill for conhecido (formulário de dúvidas), aplicar `typ` ou checar `azp`/`scope`. |
| 7 | BAIXA | O discovery não tinha backoff após falha. | Curado (`623ba1e`): cooldown de 10 s. Com teste. |
| 8 | BAIXA | Uma origem CORS com barra final passava na validação e nunca casava. | Curado (`623ba1e`): exige origem exata. |
| 9 | BAIXA | O token aceito por atributo ficava legível no DOM. | Curado (`6f0bb43`): o atributo é lido uma vez e removido; o caminho suportado é a propriedade. |
| 10 | BAIXA | O workflow não declarava `permissions:`. | Curado (`6f0bb43`): `contents: read`. |
| 11 | BAIXA | Faltavam testes de falha da auth: discovery fora, `kid` desconhecido, token sem `exp`. | Curado (`623ba1e`). Revelou um teste de discovery que não exercitava o discovery, também corrigido. |

## Cobertura (@branch-test-planner)

As 10 lacunas apontadas foram cobertas nos dois commits acima, entre elas:
- `nbf` e tolerância de relógio;
- token sem `sub` ou `exp`;
- redação de CPF, e-mail e senha;
- `x-request-id` inseguro;
- 400 sem ecoar o valor;
- 200 malformado no web;
- race de token em voo;
- Escape no dropdown;
- preflight CORS no smoke.

Ficaram para E2+ por decisão declarada: medição de cobertura com piso no CI, autorização por perfil (sem rota que a use) e concorrência com várias réplicas (fora do desenho com SQLite).

## Resultado

API com 68 testes e web com 22. Smoke completo verde no Compose local e zero JWT nos logs do container.
