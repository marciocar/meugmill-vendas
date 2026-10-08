# STATE — carteira-e2-dados-mestres

## Objective
Cadastro próprio dos dados mestres (filiais, clientes, vendedores, subgrupos, redes, grupos econômicos,
localidades IBGE) com API REST escopada por filial, para E3/E4 consumirem — ver context.md.

## Constraints
- Sem CPF; vendedor só código e nome; nada de dado pessoal em log
- Escrita só admin nas filiais do token; fora do escopo = 404
- Soft delete; `If-Match` obrigatório em PATCH/deactivate/reactivate
- Acesso ao banco só via Drizzle; seed IBGE versionado (sem rede no boot)
- `.env` só pelo helper; nunca `rm` com glob; commits Conventional (en) + pt-BR
- Fases 3 e 4 em paralelo: o orquestrador registra rotas no `app.ts`

## Map
- architecture.md → §2 modelo (F1), §3 authz (F2), §4 contrato (F3–F5), §5 arquivos
- context.md      → decisões; pular no resume
- plan.md         → ler SÓ o bloco da fase [ACTIVE]
- task-manager    → main: OG1-T3 (2723266000000151010) · provider: zoho

## NEXT
phase: 3
phase_title: API dos catálogos, filiais e localidades (Fase 4 em paralelo)
status: in_progress
next_action: "Integrar as rotas das Fases 3 e 4 no app.ts quando os agentes terminarem e validar o contrato HTTP"
blocked_by: none
files_in_flight: [apps/api/src/routes/v1/]
validate_with: "pnpm --filter @meugmill/api test"
last_checkpoint: 2026-10-08T01:00Z

## Native transcript
resume_command: claude --resume <id>
