# Arquitetura — carteira-e1-fundacao

> Escopo: fundação (E1). Regras de negócio da carteira ficam em E2–E10. Decisões de stack em
> [context.md](context.md#decisões-tomadas-maestro-2026-10-07).

## 1. Visão geral

**Antes:** o repo só tem documentação (business-context, grafo de domínio) e o framework Onion. Não há código.

**Depois:**

```
                 sistema principal (GMill)
        ┌──────────────┴───────────────┐
        │ <script> + <gmill-carteira   │ chama a API com JWT do IdP deles
        │   api-base token>            │
        ▼                              ▼
  ┌──────────────┐  HTTP /v1/*  ┌───────────┐    Drizzle    ┌──────────────┐
  │ apps/web     │ ───(CORS)──▶ │ apps/api  │ ────────────▶ │ SQLite (WAL) │
  │ Web Component│              │ Fastify   │               │ volume /data │
  │ React + Vite │              └─────┬─────┘               └──────────────┘
  └──────────────┘                    │ JWKS (cache)
                                       ▼
                         IdP (produção: do sistema principal;
                              dev: mock-oauth2-server no Compose)
```

## 2. Estrutura do monorepo (pnpm workspaces)

```
apps/
  api/                      # Fastify + TypeScript
    src/
      app.ts                # buildApp(config) — fábrica testável, sem listen()
      server.ts             # entrypoint: carrega config, listen, shutdown gracioso
      config.ts             # env validado por schema (falha no boot se faltar)
      plugins/
        db.ts               # conexão SQLite + Drizzle, PRAGMAs, decorate fastify.db
        auth.ts             # verificação JWT via JWKS (jose), decorate request.user
        observability.ts    # pino, request id, redação
      routes/
        health.ts           # /health, /ready
        me.ts               # /v1/me (rota protegida de exemplo)
      db/
        schema.ts           # vazio no E1 (só a tabela técnica de verificação, se precisar)
        migrations/         # geradas pelo drizzle-kit, versionadas
    test/                   # Vitest + fastify.inject
  web/                      # React + Vite em library mode → gmill-carteira.js
    src/
      element.tsx           # define <gmill-carteira>: Shadow DOM, atributos, eventos
      App.tsx               # raiz React montada dentro do shadow root
    demo/index.html         # página que simula o host embarcando o componente
packages/
  shared/                   # tipos e schemas comuns (ex.: claims do usuário)
docker/
  api.Dockerfile
  web.Dockerfile            # build Vite → nginx servindo os estáticos (sem Node em runtime)
compose.yaml                # api + web (nginx) + idp (dev) + volume do SQLite
.github/workflows/ci.yml
```

## 3. Componentes e escolhas

| Componente | Escolha | Por quê |
|---|---|---|
| Runtime | Node.js LTS ativo, fixado em `.nvmrc` e `engines` | API e front na mesma linguagem; imagem única de base |
| Gerenciador | pnpm workspaces | Monorepo leve, lockfile único; sem Nx no E1 (dá para adotar depois) |
| API | Fastify, com plugins encapsulados e `buildApp()` | Testável sem porta aberta (`inject`); schemas JSON nativos |
| Validação | TypeBox (schema JSON + tipo TS) | Nativo do ecossistema Fastify; o mesmo schema valida e documenta |
| Config | env validado no boot | Falha rápida e explícita; nenhuma credencial em código |
| Banco | SQLite via `better-sqlite3` + **Drizzle** + `drizzle-kit` | ORM com dialeto trocável para PostgreSQL; migrations em SQL versionado |
| PRAGMAs | `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout` | Concorrência de leitura e integridade referencial (o SQLite vem com FK desligada) |
| Auth | `jose` com `createRemoteJWKSet`; valida `iss`, `aud`, `exp`, `nbf`, algoritmo permitido | Sem segredo compartilhado; rotação de chave do IdP sem redeploy |
| IdP de dev | `mock-oauth2-server` no Compose | Emite tokens OIDC reais para teste local e de integração |
| Logs | pino (logger do Fastify) com `redact` | JSON estruturado; redação de `authorization`, cookies e campos pessoais |
| Correlation id | `x-request-id` aceito ou gerado; ecoado na resposta | Rastrear uma chamada do sistema principal até aqui |
| Front | React + Vite (library mode) → custom element `<gmill-carteira>` com Shadow DOM | Embarca em qualquer framework do host; estilo isolado; React vai dentro do bundle |
| Contrato com o host | atributos `api-base` e `token` (também como propriedades); evento DOM `token-expired`; nenhum armazenamento de credencial | Acoplamento só por padrões do DOM; o host continua dono do login |
| CORS | origens do host por env (`CORS_ORIGINS`) | O componente roda no domínio do host e chama a API em outro |
| Testes | Vitest | Mesmo runner na API e em `packages/shared` |
| Qualidade | ESLint + Prettier + `tsc --noEmit` | Gate de CI |
| Container | Dockerfile multi-stage em `node:<lts>-slim` (Debian) | `better-sqlite3` é módulo nativo; o Alpine (musl) complica o build |
| CI | GitHub Actions: install → lint → typecheck → test → build das imagens | O remoto é GitHub; o workflow é arquivo do repo e não passa pelo adapter de forge |

## 4. Padrões mantidos ou introduzidos

- **Fábrica de app** (`buildApp`) separada do entrypoint: todo teste sobe a app real em memória.
- **Plugins por responsabilidade** (db, auth, observability); rotas só consomem o que foi decorado.
- **Rotas versionadas** em `/v1`; `/health` e `/ready` ficam fora da versão e sem auth.
- **Falha fechada na auth:** sem token, token inválido ou JWKS indisponível → 401/503, nunca acesso.
- **Minimização (LGPD):** `request.user` guarda só `sub` e as claims de perfil/filial necessárias.
  Nenhum CPF e nenhum dado de paciente. Logs nunca registram token nem corpo de requisição.
- **Shutdown gracioso:** em SIGTERM o servidor fecha conexões e o banco, sem corromper o WAL.

## 5. Dependências externas

- IdP do sistema principal (issuer, audience e JWKS por env) — em aberto com o contato da GMill.
- Imagem `mock-oauth2-server` (só dev/CI).
- GitHub Actions.

## 6. Restrições e suposições

- **Uma instância da API por arquivo SQLite** (único escritor). O Compose não declara réplicas.
- O volume `/data` é a única coisa com estado; backup fica fora do E1, mas o caminho é configurável.
- `[INFERIDO]` O host aceita carregar um script externo e repassar o token ao componente. No E1, a
  página de demonstração chama `/v1/me` com um token do IdP de dev para provar o caminho de ponta a ponta.
- Risco técnico novo: Shadow DOM com React (injeção de CSS no shadow root, portais de modal/dropdown).
  Validar já na Fase 1 com um componente que use portal.
- `[INFERIDO]` Claims de perfil e filial: os nomes reais dependem do IdP. O E1 mapeia por configuração
  e testa com claims fictícias.

## 7. Trade-offs e alternativas consideradas

| Decisão | Alternativa | Por que não agora |
|---|---|---|
| SQLite | PostgreSQL | Escolha do maestro. O Drizzle mantém a troca barata (ver risco 1 no contexto) |
| Drizzle | Prisma | Prisma traz engine própria e cliente gerado; Drizzle é SQL-first, mais leve e tem migrations legíveis |
| `jose` + JWKS | `@fastify/jwt` | `@fastify/jwt` usa segredo ou chave fixa; JWKS remoto com cache e rotação é nativo no `jose` |
| pnpm workspaces | Nx | Dois apps e um pacote não justificam Nx; migrar depois é viável |
| Logs JSON + request id | OpenTelemetry completo | OTel entra quando houver coletor no ambiente da GMill; o request id já dá rastreio básico |
| `node:slim` | Alpine | Módulo nativo do SQLite; imagem um pouco maior em troca de build previsível |
| Web Component (React + Vite) | Next.js | Next é uma aplicação inteira (servidor, roteamento), não um componente; SSR e SEO não ajudam numa ferramenta interna embarcada (trocado em 2026-10-07) |
| Web Component | iframe / rota sob proxy | iframe tem atrito de altura, visual e sessão; proxy deixa a tela ao lado da deles, não dentro |

## 8. Arquivos principais a criar

`package.json` (raiz), `pnpm-workspace.yaml`, `.nvmrc`, `tsconfig.base.json`, `eslint.config.mjs`,
`apps/api/**` (seção 2), `apps/web/**` (Web Component + página demo), `packages/shared/**`,
`docker/api.Dockerfile`, `docker/web.Dockerfile`, `compose.yaml`, `.env.example` (acrescentar as
variáveis do serviço, sem tocar nas do Onion), `.github/workflows/ci.yml`,
`docs/technical-context/` (registro da stack — via `/docs:build-tech-docs` ao fim do E1).

## 9. Fases (detalhe em plan.md)

1. Monorepo e esqueleto (API Fastify com `/health` + Web Component com página demo)
2. Persistência SQLite, Drizzle, migrations e `/ready`
3. Autenticação JWT/JWKS e `/v1/me`, com IdP de dev
4. Observabilidade (logs, request id, redação) e base LGPD
5. Dockerfiles, Compose e CI
