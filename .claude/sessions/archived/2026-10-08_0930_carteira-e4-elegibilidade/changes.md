# Plano — carteira-e4-elegibilidade

> Marcadores lidos por máquina: `[DONE]` / `[ACTIVE]` / `[TODO]`. Exatamente uma fase `[ACTIVE]`, igual a
> `STATE.md` → `NEXT.phase`. Arquitetura: [architecture.md](architecture.md). Zoho: OG1-T5 (+25 por fase).
> Condução: `/meta:drive` com aprovações automáticas; merge humano.

## Fase 1 — Schema dos ajustes e motor de elegibilidade [DONE]

- [x] `portfolio_customer_overrides` + migration `0005`
- [x] `domain/eligibility/query.ts`: SQL único, nível de região casado, critérios casados
- [x] Testes de regra (OU dentro / E entre, níveis, cliente/vínculo inativo, sem filtro) e volume sintético (50k) com tempo medido + `EXPLAIN QUERY PLAN`

**Concluída 2026-10-08** · 415 testes · 50k clientes: 165 ms (1ª página + total). Plano: SCAN em customers por PK (risco a observar em volume muito maior).

## Fase 2 — Prévia e ajustes no domínio [DONE]

- [x] `service.ts`: preview (cursor, q, source, total), overrides get (effective) e replace (validações, If-Match, versão, inativa)

## Fase 3 — API da prévia e dos ajustes [DONE]

- [x] Rotas `preview` e `overrides`; contagens no agregado; contrato HTTP

**Fases 2 e 3 concluídas 2026-10-08** · `4077d17` (domínio) e `57d97ed` (API) · 442 testes.

## Fase 4 — OpenAPI, smoke, docs e revisão [DONE]

- [x] `openapi-v1.json`, smoke, `api-elegibilidade.md`, inventário; revisão + lacunas em paralelo

**Concluída 2026-10-08** · smoke `e0e5c85` · correções `90d5ee5` (vazamento ALTO) e `25d2eb4` (órfãos) · 457 testes · verificação adversarial APROVOU.

## Fechamento do E4 [DONE]

- Revisão: 1 ALTO (vazamento de escopo) reproduzido, curado e confirmado por verificação adversarial; 1 médio e 6 baixos curados. Resíduo em `docs/evolution/review/feature-carteira-e4-elegibilidade.md`.
