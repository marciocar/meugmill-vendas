# Plano — carteira-e2-dados-mestres

> Marcadores lidos por máquina: `[DONE]` / `[ACTIVE]` / `[TODO]`. Exatamente uma fase `[ACTIVE]`, igual a
> `STATE.md` → `NEXT.phase`. Arquitetura: [architecture.md](architecture.md). Zoho: OG1-T3
> (`completion_percentage` +20 por fase; o layout só tem Open/Closed).

## Fase 1 — Schema, migrations e seed IBGE [ACTIVE]

- [ ] `src/db/schema.ts`: tabelas da arquitetura §2, colunas comuns, índices e FKs
- [ ] Migration `0001` gerada pelo `drizzle-kit`
- [ ] `apps/api/scripts/build-ibge-seed.ts` + snapshot JSON datado do IBGE → migration custom `0002_seed_ibge.sql` (fonte e data no cabeçalho)
- [ ] Testes: tabelas criadas, `foreign_keys` impedindo órfãos, 27 UFs e ~5.570 municípios, ES/Serra presentes

**Validar:** `pnpm --filter @meugmill/api test`

## Fase 2 — Domínio: validação, autorização e repositórios [TODO]

- [ ] `domain/shared`: `cnpj.ts` (normaliza, valida DV), `normalize.ts` (`neighborhood_key`), `authz.ts`, `errors.ts`, `pagination.ts`
- [ ] Services e repositórios: catálogo genérico, filiais, vendedores, clientes, geo
- [ ] Regras: unicidade (inclusive inativos), coerência UF × município, escopo por filial, `version`, soft delete idempotente, transação nos vínculos N:N, `customer_exists`
- [ ] Testes de domínio sem HTTP

## Fase 3 — API dos catálogos, filiais e localidades [TODO] (paralela à 4)

- [ ] `routes/v1/catalog.ts` (fábrica para subgrupos, redes e grupos econômicos), `branches.ts`, `geo.ts`
- [ ] `ETag`/`If-Match` (428, 409), paginação, 403 sem admin, 404 fora do escopo
- [ ] Testes de contrato HTTP com JWT por perfil e filial

## Fase 4 — API de clientes e vendedores [TODO] (paralela à 3)

- [ ] `routes/v1/sellers.ts`, `customers.ts` (incluindo `by-cnpj/{cnpj}/branches`)
- [ ] Vínculos N:N com regra de filiais do token; `customer_exists`
- [ ] Testes de contrato HTTP; nome do vendedor e CNPJ ausentes dos logs

## Fase 5 — OpenAPI, smoke e documentação [TODO]

- [ ] `@fastify/swagger` → `GET /v1/openapi.json`
- [ ] `scripts/smoke.sh`: criar → ler → inativar um subgrupo com token de admin
- [ ] `docs/technical-context/api-dados-mestres.md` (com carimbo de frescor) e inventário regenerado
- [ ] Revisão de diff + lacunas de teste em paralelo antes do PR
