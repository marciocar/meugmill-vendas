# Plano — carteira-e1-fundacao

> Cada fase é um chunk auto-contido. Marcadores lidos por máquina: `[DONE]` / `[DONE]` / `[TODO]`.
> Exatamente uma fase `[DONE]`, igual a `STATE.md` → `NEXT.phase`. Arquitetura: [architecture.md](architecture.md).
> Zoho: OG1-T2. Ao concluir cada fase, `completion_percentage` += 20 (o layout só tem Open/Closed).

## Fase 1 — Monorepo e esqueleto [DONE]

**Input:** repo só com docs e framework. **Output:** `pnpm install && pnpm -r test && pnpm -r build` verdes.

- [x] Raiz: `package.json` (scripts `lint`, `typecheck`, `test`, `build`), `pnpm-workspace.yaml`, `.nvmrc`,
      `tsconfig.base.json`, `eslint.config.mjs`, Prettier (respeitar `.prettierignore` existente)
- [x] `packages/shared`: tipo `UserClaims` mínimo (`sub`, `roles`, `branchIds`) e build
- [x] `apps/api`: `buildApp()`, `server.ts` com shutdown gracioso, `config.ts` validado, `GET /health`
- [x] `apps/api/test/health.test.ts` com `fastify.inject`
- [x] `apps/web`: Vite library mode gerando `gmill-carteira.js`; `element.tsx` define `<gmill-carteira>`
      com Shadow DOM, atributos/propriedades `api-base` e `token`, evento `token-expired`
- [x] `apps/web/demo/index.html` embarcando o componente como um host faria
- [x] Prova de risco: um componente com portal (dropdown) renderizando dentro do shadow root, com CSS injetado
- [x] Teste do custom element (Vitest + jsdom/happy-dom): registra, lê atributos, reage a mudança de `token`

**Concluída 2026-10-07** · commit `8770052` · 10 testes · bundle 368 kB (84 kB gzip). Node 22 (instalado). O demo ainda não foi aberto no navegador: o isolamento do CSS do host será conferido na fumaça da Fase 5.

**Validar:** `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build`

## Fase 2 — Persistência SQLite e migrations [DONE]

**Output:** banco criado por migration no boot; `/ready` reflete o banco.

- [x] `plugins/db.ts`: `better-sqlite3` + Drizzle; PRAGMAs `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout`
- [x] `drizzle-kit` configurado; pasta `db/migrations` versionada; migration inicial técnica
- [x] Migrations aplicadas no boot (ou comando dedicado) com caminho do arquivo por env (`DATABASE_PATH`)
- [x] `GET /ready` → 200 com banco ok, 503 sem banco
- [x] Testes com banco em arquivo temporário; teste de que FK está ligada

**Concluída 2026-10-07** · commit `0571522` · 17 testes. Migrations em `apps/api/drizzle/` (fora de src; a imagem precisa copiá-las). Novas: `pnpm --filter @meugmill/api db:generate`.

**Validar:** `pnpm --filter api test`

## Fase 3 — Autenticação JWT/JWKS [DONE]

**Output:** `/v1/me` só responde com token válido do IdP configurado.

- [x] `plugins/auth.ts` com `jose` (`createRemoteJWKSet`): valida `iss`, `aud`, `exp`, `nbf`, algoritmos permitidos
- [x] Mapeamento de claims → `UserClaims` por configuração; defaults `sub`/`branch_ids`/`roles` (hipótese provisória, ver docs/business-context/02-product/features/carteira-de-clientes-hipoteses.md)
- [x] `GET /v1/me` devolvendo só `UserClaims` (minimização)
- [x] Falha fechada: sem token/inválido → 401; JWKS indisponível → 503
- [x] Testes: válido, expirado, issuer errado, audience errada, sem token, JWKS fora (JWKS local no teste)
- [x] CORS por `CORS_ORIGINS`; a página demo chama `/v1/me` com token do IdP de dev

**Validar:** `pnpm --filter api test`

**Concluída 2026-10-07** · api `b8a4f81` (35 testes) · web `7a277c9` (12 testes). Claims padrão vêm das hipóteses provisórias.

## Fase 4 — Observabilidade e base LGPD [DONE]

**Output:** logs JSON rastreáveis, sem dado sensível.

- [x] pino com `redact` (`authorization`, cookies, `token`, campos pessoais); nunca logar corpo de requisição
- [x] `x-request-id` aceito ou gerado, ecoado na resposta e em todos os logs da requisição
- [x] Teste que captura o log e prova que o token não aparece
- [x] `docs/technical-context/`: nota de minimização (o que o serviço guarda, o que nunca guarda: CPF, dado de paciente)

**Validar:** `pnpm --filter api test`

**Concluída 2026-10-07** · `db57fe6` · zero JWT nos logs do container.

## Fase 5 — Container, Compose e CI [DONE]

**Output:** `docker compose up` sobe tudo num clone limpo; CI verde.

- [x] `docker/api.Dockerfile` multi-stage `node:<lts>-slim`, usuário não-root, volume `/data`
- [x] `docker/web.Dockerfile`: build Vite → nginx servindo `gmill-carteira.js` e a demo
- [x] `compose.yaml`: api + web + `mock-oauth2-server` + volume; uma réplica da API
- [x] Variáveis documentadas com defaults no `compose.yaml` (a guarda do `.env` impede editar `.env.example` por agente)
- [x] Fumaça: `/health` 200, `/ready` 200, `/v1/me` 401 sem token e 200 com token do IdP de dev
- [x] `.github/workflows/ci.yml`: install → lint → typecheck → test → build das imagens
- [ ] `/docs:build-tech-docs` para registrar a stack no technical-context (fica para o fechamento do E1)

**Validar:** `docker compose up -d && bash scripts/smoke.sh` + CI verde no PR

**Concluída 2026-10-07 (em paralelo à Fase 3)** · `a9cf04d` · smoke verde no Compose local. CI ainda não executado (sem push). Neste host o `docker compose build` falha por permissão do buildx; usar `docker build -t carteira-{api,web}:local` + `docker compose up -d --no-build`.

## Fechamento do E1 [DONE]

- Revisão do diff (`@branch-code-reviewer`): nenhum achado alto; 4 médios e 5 baixos corrigidos em `623ba1e` (api) e `6f0bb43` (web/infra). O `typ` do token (access × ID token) ficou como hipótese `[INFERIDO]` dependente do IdP da GMill.
- Lacunas de teste (`@branch-test-planner`) cobertas: API 68 testes, web 22; smoke com espera do IdP e preflight CORS real.
- Pendências para fora do E1: CI nunca executado (sem push); `/docs:build-tech-docs`; confirmar hipóteses com o cliente (formulário enviado); `typ at+jwt` quando o IdP for conhecido.
