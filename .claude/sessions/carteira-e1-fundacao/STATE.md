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
phase: 1
phase_title: Monorepo e esqueleto (API Fastify + Web Component Vite)
status: todo
next_action: "Criar package.json raiz, pnpm-workspace.yaml, .nvmrc e tsconfig.base.json"
blocked_by: none
files_in_flight: []
validate_with: "pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build"
last_checkpoint: 2026-10-07T18:31Z

## Native transcript
resume_command: claude --resume <id>
