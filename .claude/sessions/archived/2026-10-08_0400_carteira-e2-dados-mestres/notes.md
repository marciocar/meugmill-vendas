# Notas — carteira-e2-dados-mestres

- 2026-10-08: sessão aberta. Decisões: região por IBGE + bairro normalizado; cliente global N:N com filiais; escrita só admin; soft delete.
- 2026-10-08: Fase 1 concluída (b5ad709); .gitignore ganhou exceção para apps/api/drizzle/data/.
- 2026-10-08: Fase 2 concluída (domínio, 131 testes). Fases 3 e 4 disparadas em paralelo; a Fase 4 fica marcada [TODO] no plano para manter uma só [ACTIVE], mas roda junto.
- 2026-10-08: Fases 3 e 4 (paralelas) concluídas e unificadas; CNPJ alfanumérico aprovado pelo maestro e implementado (DV conferido de forma independente).
- 2026-10-08: revisão do E2 — 1 alto (link por CNPJ) decidido pelo maestro: ativo por vínculo + dados compartilhados protegidos + link sem dados; vendedor idem com by-code. Curado em 4e8f410; logs do 500 blindados em a8c3134. 298 testes, smoke verde. E2 concluído localmente.
