# STATE — carteira-e1-fundacao

## Objective
Erguer a fundação do microserviço Carteira de Clientes (API Fastify, Web Component React/Vite, SQLite,
auth JWKS, observabilidade, Compose, CI) para os épicos E2–E10 — ver context.md.

## Constraints
- Sem regra de negócio de carteira (é E2+); sem CPF nem dado de paciente (LGPD)
- Uma instância da API por arquivo SQLite; acesso ao banco só via Drizzle
- Falha fechada na auth; nenhum token em log
- Não apagar `[INFERIDO]`/`[TO BE COMPLETED]`; commits Conventional (en) + texto pt-BR
- `.env` só pelo helper `env-check.sh`; nunca ler com Read/cat/grep

## Map
- architecture.md → §2 estrutura, §3 escolhas (todas as fases); §7 trade-offs
- context.md      → background e riscos; pular no resume
- plan.md         → ler SÓ o bloco da fase [ACTIVE]
- task-manager    → main: OG1-T2 (2723266000000146018) · provider: zoho · status via completion_percentage (+20/fase)

## NEXT
phase: 3
phase_title: Autenticação JWT/JWKS
status: in_progress
next_action: "Criar apps/api/src/plugins/auth.ts com jose createRemoteJWKSet e a rota GET /v1/me"
blocked_by: none
files_in_flight: [apps/api/src/plugins/auth.ts, apps/api/src/routes/me.ts]
validate_with: "pnpm --filter @meugmill/api test"
last_checkpoint: 2026-10-07T19:05Z

## Native transcript
resume_command: claude --resume <id>
