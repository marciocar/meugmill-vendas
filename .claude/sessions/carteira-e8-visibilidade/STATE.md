# STATE — carteira-e8-visibilidade

## Objective
Carteira como regra de visibilidade (vendedor/gestor/admin/supervisão) e consulta para o sistema principal — ver context.md.

## Constraints
- /meta:drive E8–E10; merge humano em lote; branches empilhadas E8 → E10 → E9
- Vínculos ativos do E7 são a fonte da verdade; filiais do token sempre limitam
- `.env` só pelo helper; nunca `rm` com glob

## Map
- architecture.md → modelo, perfis, CTE, restrições, contrato
- plan.md → só a fase [ACTIVE]
- task-manager → OG1-T9 (2723266000000151016) · zoho

## NEXT
phase: 1
phase_title: Ligação login × vendedor, serviço de visibilidade e restrição das leituras
status: in_progress
next_action: "Criar sellers.user_sub e domain/visibility"
blocked_by: none
files_in_flight: [apps/api/src/domain/visibility/]
validate_with: "pnpm test && pnpm --filter @meugmill/api test:perf"
last_checkpoint: 2026-10-08T18:00Z
