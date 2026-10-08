# Plano — carteira-e2-dados-mestres

> Marcadores lidos por máquina: `[DONE]` / `[ACTIVE]` / `[TODO]`. Exatamente uma fase `[ACTIVE]`, igual a
> `STATE.md` → `NEXT.phase`. Arquitetura: [architecture.md](architecture.md). Zoho: OG1-T3
> (`completion_percentage` +20 por fase; o layout só tem Open/Closed).

## Fase 1 — Schema, migrations e seed IBGE [DONE]

- [x] `src/db/schema.ts`: tabelas da arquitetura §2, colunas comuns, índices e FKs
- [x] Migration `0001` gerada pelo `drizzle-kit`
- [x] `apps/api/scripts/build-ibge-seed.ts` + snapshot JSON datado do IBGE → migration custom `0002_seed_ibge.sql` (fonte e data no cabeçalho)
- [x] Testes: tabelas criadas, `foreign_keys` impedindo órfãos, 27 UFs e ~5.570 municípios, ES/Serra presentes

**Concluída 2026-10-08** · `b5ad709` · 74 testes · 27 UFs e 5.571 municípios.

**Validar:** `pnpm --filter @meugmill/api test`

## Fase 2 — Domínio: validação, autorização e repositórios [DONE]

- [x] `domain/shared`: `cnpj.ts` (normaliza, valida DV), `normalize.ts` (`neighborhood_key`), `authz.ts`, `errors.ts`, `pagination.ts`
- [x] Services e repositórios: catálogo genérico, filiais, vendedores, clientes, geo
- [x] Regras: unicidade (inclusive inativos), coerência UF × município, escopo por filial, `version`, soft delete idempotente, transação nos vínculos N:N, `customer_exists`
- [x] Testes de domínio sem HTTP

**Concluída 2026-10-08** · 131 testes. Services síncronos; respostas de cliente/vendedor só com filiais do escopo do ator. Risco aberto: CNPJ alfanumérico (Receita, jul/2026).

## Fase 3 — API dos catálogos, filiais e localidades [DONE] (paralela à 4)

- [x] `routes/v1/catalog.ts` (fábrica para subgrupos, redes e grupos econômicos), `branches.ts`, `geo.ts`
- [x] `ETag`/`If-Match` (428, 409), paginação, 403 sem admin, 404 fora do escopo
- [x] Testes de contrato HTTP com JWT por perfil e filial

## Fase 4 — API de clientes e vendedores [DONE] (paralela à 3)

- [x] `routes/v1/sellers.ts`, `customers.ts` (incluindo `by-cnpj/{cnpj}/branches`)
- [x] Vínculos N:N com regra de filiais do token; `customer_exists`
- [x] Testes de contrato HTTP; nome do vendedor e CNPJ ausentes dos logs

**Fases 3 e 4 concluídas 2026-10-08 (em paralelo)** · 225 testes. Integração única: `http.ts` + `crud.ts`, `v1Routes` no `app.ts`; auth em `onRequest` (401 antes de validar); `If-Match` ausente 428, malformado 400; CNPJ alfanumérico (IN RFB 2.229/2024) com DV conferido no exemplo oficial `12ABC34501DE35`; CNPJ mascarado no path dos logs.

## Fase 5 — OpenAPI, smoke e documentação [DONE]

- [x] `@fastify/swagger` → `GET /v1/openapi.json`
- [x] `scripts/smoke.sh`: criar → ler → inativar um subgrupo com token de admin
- [x] `docs/technical-context/api-dados-mestres.md` (com carimbo de frescor) e inventário regenerado
- [x] Revisão de diff + lacunas de teste em paralelo antes do PR

**Concluída 2026-10-08** · `cba92a4` + correções da revisão `a8c3134` e `4e8f410` · 298 testes · smoke verde.

## Fechamento do E2 [DONE]

- Revisão: 1 alto (cliente/vendedor compartilhado) decidido pelo maestro e curado; 2 médios e 6 baixos curados. Resíduo em `docs/evolution/review/feature-carteira-e2-dados-mestres.md`.
- Em aberto, a critério do maestro: rota explícita `deactivate-global` em vez da escalada implícita.
- Pendências fora do E2: confirmar com a GMill que `branch_ids` do token são códigos de filial; validar respostas contra o OpenAPI (Ajv) no E3+.
