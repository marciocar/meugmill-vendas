# Plano — carteira-e3-cadastro-carteira

> Marcadores lidos por máquina: `[DONE]` / `[ACTIVE]` / `[TODO]`. Exatamente uma fase `[ACTIVE]`, igual a
> `STATE.md` → `NEXT.phase`. Arquitetura: [architecture.md](architecture.md). Zoho: OG1-T4
> (`completion_percentage` +25 por fase; o layout só tem Open/Closed).

## Fase 1 — Schema e migration da carteira [DONE]

- [x] Tabelas do §2: `portfolio_types`, `portfolios`, `portfolio_regions`, `portfolio_retail_networks`, `portfolio_economic_groups`, `portfolio_sellers`
- [x] CHECK de coerência de nível em `portfolio_regions`; unicidade (`branch_id`, `name_key`); índices
- [x] Migration `0004` gerada e versionada
- [x] Testes de integridade (FKs, CHECK, unicidade, cascade)

**Concluída 2026-10-08** · `7ce9dfc` · 315 testes. Unicidade de região via coluna gerada `region_key`.

## Fase 2 — Domínio da carteira [DONE]

- [x] `domain/portfolio-types` (catálogo genérico)
- [x] `domain/portfolios`: create, get (agregado), list (resumo), update, replaceFilters, replaceSellers, deactivate, reactivate
- [x] Autorização por dono (admin da filial ou responsável); filial e responsável só admin
- [x] Validações: regiões × IBGE, referências ativas, vendedor com vínculo ativo na filial, troca de filial compatível, duplicatas no PUT
- [x] Testes de domínio sem HTTP

## Fase 3 — API da carteira e do tipo [DONE]

- [x] `routes/v1/portfolio-types.ts` (fábrica de catálogo) e `routes/v1/portfolios.ts` (§4)
- [x] Registro em `v1Routes`; contrato HTTP com JWT de admin, responsável e leitor

**Fases 2 e 3 concluídas 2026-10-08** · `b0eb894` (domínio) e `4f2d115` (API) · 366 testes.

## Fase 4 — OpenAPI, smoke, docs e revisão [DONE]

- [x] `openapi-v1.json` regerado
- [x] Smoke: rascunho → filtros → vendedores → resumo
- [x] `docs/technical-context/api-carteiras.md` + inventário
- [x] Revisão de diff + lacunas de teste em paralelo

**Concluída 2026-10-08** · smoke `3f39310` + correções da revisão `632a925` · 395 testes · smoke verde 3× (inclusive sobre banco com carteiras).

## Fechamento do E3 [DONE]

- Revisão: nenhum achado alto; 2 médios (nome insensível a pontuação; carteira inativa não editável) e 7 baixos curados. Resíduo em `docs/evolution/review/feature-carteira-e3-cadastro-carteira.md`.
- Decisões do orquestrador declaradas ao maestro: carteira inativa não aceita edição; vendedor sem vínculo não bloqueia reativar.
