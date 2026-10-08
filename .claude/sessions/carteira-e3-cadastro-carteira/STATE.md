# STATE — carteira-e3-cadastro-carteira

## Objective
Cadastro da carteira (informações, filtros, vendedores × subgrupos, resumo) como agregado editável por
etapa do wizard, para o E4 montar a prévia — ver context.md.

## Constraints
- Responsável só como `sub` (sem nome/e-mail); nada de dado pessoal em log ou resposta
- Admin da filial ou responsável editam; filial/responsável/inativar só admin; fora do escopo = 404
- Status (draft/active) separado de active (soft delete); ativação só no E7
- `If-Match` em toda escrita; versão única no agregado
- `.env` só pelo helper; nunca `rm` com glob; commits Conventional (en) + pt-BR

## Map
- architecture.md → §2 modelo (F1), §3 authz e validações (F2), §4 contrato (F3/F4)
- context.md      → decisões; pular no resume
- plan.md         → ler SÓ o bloco da fase [ACTIVE]
- task-manager    → main: OG1-T4 (2723266000000145015) · provider: zoho

## NEXT
phase: 1
phase_title: Schema e migration da carteira
status: in_progress
next_action: "Acrescentar as tabelas do E3 em apps/api/src/db/schema.ts e gerar a migration 0004"
blocked_by: none
files_in_flight: [apps/api/src/db/schema.ts, apps/api/drizzle/]
validate_with: "pnpm --filter @meugmill/api test"
last_checkpoint: 2026-10-08T04:30Z

## Native transcript
resume_command: claude --resume <id>
