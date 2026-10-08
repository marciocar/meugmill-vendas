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
phase: done
phase_title: E2 concluído — aguardando decisão de push/PR
status: done
next_action: "Com o ok do maestro: push da feature/carteira-e2-dados-mestres e PR via /engineer:pr"
blocked_by: decisão do maestro (push/PR; rota deactivate-global opcional)
files_in_flight: []
validate_with: "pnpm test && bash scripts/smoke.sh"
last_checkpoint: 2026-10-08T03:30Z

## Native transcript
resume_command: claude --resume <id>
