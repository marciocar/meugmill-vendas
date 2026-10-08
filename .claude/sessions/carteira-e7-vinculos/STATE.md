# STATE — carteira-e7-vinculos

## Objective
Finalizar a carteira gravando vínculos (com histórico e outbox) a partir das atribuições do E6; re-finalizar faz o diff — ver context.md.

## Constraints
- Branch empilhada sobre o E6; /meta:drive; merge humano em lote
- Grade só via loadAssignmentGrid dentro da transação; vínculo encerrado nunca é apagado
- `.env` só pelo helper; nunca `rm` com glob

## Map
- architecture.md → modelo, finalizar, inativar, contrato
- plan.md → só a fase [ACTIVE]
- task-manager → OG1-T8 (2723266000000144091) · zoho

## NEXT
phase: 1
phase_title: Vínculos, finalização, histórico e outbox (domínio)
status: in_progress
next_action: "Criar portfolio_links e portfolio_link_events e domain/links"
blocked_by: none
files_in_flight: [apps/api/src/domain/links/]
validate_with: "pnpm test && pnpm --filter @meugmill/api test:perf"
last_checkpoint: 2026-10-08T15:30Z
