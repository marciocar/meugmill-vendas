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
phase: done
phase_title: E3 concluído — aguardando decisão de push/PR
status: done
next_action: "Com o ok do maestro: push da feature/carteira-e3-cadastro-carteira e PR via /engineer:pr"
blocked_by: decisão do maestro (push/PR)
files_in_flight: []
validate_with: "pnpm test && bash scripts/smoke.sh"
last_checkpoint: 2026-10-08T07:00Z

## Native transcript
resume_command: claude --resume <id>
