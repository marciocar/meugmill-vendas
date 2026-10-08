# STATE — carteira-e6-distribuicao

## Objective
Distribuir os clientes assigned (E5) entre os vendedores de cada subgrupo (manual e automático, um vendedor por cliente por subgrupo), em rascunho — ver context.md.

## Constraints
- Branch empilhada sobre o E5; /meta:drive; merge humano em lote
- Membros só via effectiveMembers (E5); nada de duplicar a regra
- `.env` só pelo helper; nunca `rm` com glob

## Map
- architecture.md → modelo, status, estratégia, contrato
- plan.md → só a fase [ACTIVE]
- task-manager → OG1-T7 (2723266000000151014) · zoho

## NEXT
phase: 1
phase_title: Atribuições: schema, domínio e distribuição automática
status: in_progress
next_action: "Criar portfolio_assignments e domain/distribution"
blocked_by: none
files_in_flight: [apps/api/src/domain/distribution/]
validate_with: "pnpm test && pnpm --filter @meugmill/api test:perf"
last_checkpoint: 2026-10-08T13:30Z
