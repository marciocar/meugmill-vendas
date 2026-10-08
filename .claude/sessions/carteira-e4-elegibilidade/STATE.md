# STATE — carteira-e4-elegibilidade

## Objective
Motor de elegibilidade: prévia (sob demanda) dos clientes da carteira a partir dos filtros do E3, com
inclusão/exclusão manual persistida — ver context.md.

## Constraints
- Condução /meta:drive com aprovações automáticas; merge na main é humano
- Prévia nunca materializada no E4; conflitos são do E5
- Só dado de empresa na prévia; nada pessoal em log
- Ajustes seguem a edição do E3 (admin/responsável, If-Match, versão, portfolio_inactive)
- `.env` só pelo helper; nunca `rm` com glob; commits Conventional (en) + pt-BR

## Map
- architecture.md → §3 motor (F1/F2), §4 contrato (F3/F4)
- context.md      → decisões [auto]; pular no resume
- plan.md         → ler SÓ o bloco da fase [ACTIVE]
- task-manager    → main: OG1-T5 (2723266000000151012) · provider: zoho

## NEXT
phase: 1
phase_title: Schema dos ajustes e motor de elegibilidade
status: in_progress
next_action: "Criar portfolio_customer_overrides (migration 0005) e domain/eligibility/query.ts"
blocked_by: none
files_in_flight: [apps/api/src/db/schema.ts, apps/api/src/domain/eligibility/]
validate_with: "pnpm --filter @meugmill/api test"
last_checkpoint: 2026-10-08T07:40Z

## Native transcript
resume_command: claude --resume <id>
