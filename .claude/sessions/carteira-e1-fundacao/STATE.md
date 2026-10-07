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
phase: done
phase_title: E1 concluído — aguardando decisão de push/PR
status: done
next_action: "Com o ok do maestro: git push da main e da feature/carteira-e1-fundacao e abrir o PR via /engineer:pr"
blocked_by: decisão do maestro (push e PR são externos)
files_in_flight: []
validate_with: "pnpm lint && pnpm typecheck && pnpm test && bash scripts/smoke.sh"
last_checkpoint: 2026-10-07T20:05Z

## Native transcript
resume_command: claude --resume <id>
