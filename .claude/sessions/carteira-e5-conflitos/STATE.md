# STATE — carteira-e5-conflitos

## Objective
Resolver disputa de cliente entre carteiras da mesma filial (mais específica vence; empate bloqueia) — ver context.md.

## Constraints
- /meta:drive E5–E7, aprovações automáticas, merge humano em lote; branches empilhadas
- Reusar a regra de casamento do E4 (sem duplicar); sem materialização persistente
- `.env` só pelo helper; nunca `rm` com glob

## Map
- architecture.md → §1 posto, §2 resolução, §3 implementação
- plan.md → só a fase [ACTIVE]
- task-manager → OG1-T6 (2723266000000149033) · zoho

## NEXT
phase: 1
phase_title: Motor de conflitos e prévia com resolução
status: in_progress
next_action: "Implementar domain/conflicts e integrar a resolução à prévia do E4"
blocked_by: none
files_in_flight: [apps/api/src/domain/conflicts/, apps/api/src/domain/eligibility/]
validate_with: "pnpm --filter @meugmill/api test"
last_checkpoint: 2026-10-08T10:30Z
