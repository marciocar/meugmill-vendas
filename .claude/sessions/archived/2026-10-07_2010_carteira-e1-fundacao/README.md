# E1 — Fundação do microserviço Carteira de Clientes (arquivado)

- **Branch:** `feature/carteira-e1-fundacao` → `main` · **PR:** https://github.com/marciocar/meugmill-vendas/pull/2
- **Task:** OG1-T2 (Zoho, subtask de OG1-T1) · **Período:** 2026-10-07

## Resumo executivo

O E1 entregou a fundação do microserviço, sem regra de negócio da carteira:

- monorepo pnpm;
- API Fastify com SQLite/Drizzle, autenticação JWT via JWKS, `/v1/me` minimizado e logs com redação;
- Web Component `<gmill-carteira>` em React + Vite com Shadow DOM;
- Docker, Compose com IdP de teste, smoke e CI no GitHub Actions.

Foram 5 fases. A 5 rodou em paralelo à 3.

## Números

- 68 testes na API e 22 no web; smoke verde no Compose local e no CI.
- Revisão pré-PR: 11 achados, nenhum alto; 10 curados e 1 declarado (`typ` do token, depende do IdP).
- O 1º CI pegou o `shared` sem build num clone limpo (curado em `034cabb`).

## Arquivos deste registro

| Arquivo | Conteúdo |
|---|---|
| `context.md` | Contexto, decisões de stack, riscos e mapeamento fase→task |
| `decisions.md` | Arquitetura aprovada, com trade-offs (antigo `architecture.md`) |
| `changes.md` | Plano por fase com o fechamento de cada uma (antigo `plan.md`) |
| `notes.md` | Log da sessão, inclusive o incidente do `/tmp` |
| `files-changed.txt` | Arquivos alterados em relação à `main` |
| `commands-executed.txt` | Como validar a fundação |

## Pendências que saem daqui

- Confirmar com o cliente as hipóteses em `docs/business-context/02-product/features/carteira-de-clientes-hipoteses.md` (formulário enviado ao contato da GMill).
- Aplicar `typ: at+jwt` (ou equivalente) quando o IdP da GMill for conhecido.
- Rodar `/docs:build-tech-docs` para registrar a stack no technical-context.
- Próximo épico: E2 (CRUD de dados mestres, OG1-T3).
