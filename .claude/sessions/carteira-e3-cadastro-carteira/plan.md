# Plano — carteira-e3-cadastro-carteira

> Marcadores lidos por máquina: `[DONE]` / `[ACTIVE]` / `[TODO]`. Exatamente uma fase `[ACTIVE]`, igual a
> `STATE.md` → `NEXT.phase`. Arquitetura: [architecture.md](architecture.md). Zoho: OG1-T4
> (`completion_percentage` +25 por fase; o layout só tem Open/Closed).

## Fase 1 — Schema e migration da carteira [ACTIVE]

- [ ] Tabelas do §2: `portfolio_types`, `portfolios`, `portfolio_regions`, `portfolio_retail_networks`, `portfolio_economic_groups`, `portfolio_sellers`
- [ ] CHECK de coerência de nível em `portfolio_regions`; unicidade (`branch_id`, `name_key`); índices
- [ ] Migration `0004` gerada e versionada
- [ ] Testes de integridade (FKs, CHECK, unicidade, cascade)

## Fase 2 — Domínio da carteira [TODO]

- [ ] `domain/portfolio-types` (catálogo genérico)
- [ ] `domain/portfolios`: create, get (agregado), list (resumo), update, replaceFilters, replaceSellers, deactivate, reactivate
- [ ] Autorização por dono (admin da filial ou responsável); filial e responsável só admin
- [ ] Validações: regiões × IBGE, referências ativas, vendedor com vínculo ativo na filial, troca de filial compatível, duplicatas no PUT
- [ ] Testes de domínio sem HTTP

## Fase 3 — API da carteira e do tipo [TODO]

- [ ] `routes/v1/portfolio-types.ts` (fábrica de catálogo) e `routes/v1/portfolios.ts` (§4)
- [ ] Registro em `v1Routes`; contrato HTTP com JWT de admin, responsável e leitor

## Fase 4 — OpenAPI, smoke, docs e revisão [TODO]

- [ ] `openapi-v1.json` regerado
- [ ] Smoke: rascunho → filtros → vendedores → resumo
- [ ] `docs/technical-context/api-carteiras.md` + inventário
- [ ] Revisão de diff + lacunas de teste em paralelo
