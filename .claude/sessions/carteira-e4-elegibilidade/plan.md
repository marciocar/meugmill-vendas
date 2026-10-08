# Plano — carteira-e4-elegibilidade

> Marcadores lidos por máquina: `[DONE]` / `[ACTIVE]` / `[TODO]`. Exatamente uma fase `[ACTIVE]`, igual a
> `STATE.md` → `NEXT.phase`. Arquitetura: [architecture.md](architecture.md). Zoho: OG1-T5 (+25 por fase).
> Condução: `/meta:drive` com aprovações automáticas; merge humano.

## Fase 1 — Schema dos ajustes e motor de elegibilidade [ACTIVE]

- [ ] `portfolio_customer_overrides` + migration `0005`
- [ ] `domain/eligibility/query.ts`: SQL único, nível de região casado, critérios casados
- [ ] Testes de regra (OU dentro / E entre, níveis, cliente/vínculo inativo, sem filtro) e volume sintético (50k) com tempo medido + `EXPLAIN QUERY PLAN`

## Fase 2 — Prévia e ajustes no domínio [TODO]

- [ ] `service.ts`: preview (cursor, q, source, total), overrides get (effective) e replace (validações, If-Match, versão, inativa)

## Fase 3 — API da prévia e dos ajustes [TODO]

- [ ] Rotas `preview` e `overrides`; contagens no agregado; contrato HTTP

## Fase 4 — OpenAPI, smoke, docs e revisão [TODO]

- [ ] `openapi-v1.json`, smoke, `api-elegibilidade.md`, inventário; revisão + lacunas em paralelo
