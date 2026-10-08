# E2 — Dados mestres da carteira de clientes (arquivado)

- **Branch:** `feature/carteira-e2-dados-mestres` → `main` · **PR:** https://github.com/marciocar/meugmill-vendas/pull/6
- **Task:** OG1-T3 (Zoho, subtask de OG1-T1) · **Período:** 2026-10-08

## Resumo executivo

O E2 deu ao microserviço o cadastro próprio dos dados mestres: filiais, subgrupos, redes, grupos
econômicos, vendedores, clientes e localidades IBGE. Tudo fica exposto numa API REST `/v1` com escopo
por filial, concorrência por `If-Match` e inativação em vez de exclusão. A carteira (E3) e o motor de
elegibilidade (E4) passam a ter sobre o que operar. Foram 5 fases, com a 3 e a 4 em paralelo.

## Números

- 302 testes na API e 22 no web; smoke verde no Compose e no CI.
- Seed IBGE: 27 UFs e 5.571 municípios (coleta de 2026-10-08).
- Revisão: 1 achado alto (cliente/vendedor compartilhado), decidido pelo maestro e curado; 2 médios
  e 6 baixos curados; 10 lacunas de teste cobertas.

## Decisões do maestro

- Região: código IBGE + bairro normalizado.
- Cliente global com vínculo N:N às filiais.
- Escrita só pelo perfil admin; inativação em vez de exclusão.
- CNPJ alfanumérico já no E2.
- Ativo por vínculo; dados compartilhados exigem todas as filiais; link sem dados.
- Rota explícita `deactivate-global`.

## Arquivos deste registro

| Arquivo | Conteúdo |
|---|---|
| `context.md` | Contexto, decisões, defaults e mapeamento fase→task |
| `decisions.md` | Arquitetura, inclusive a correção da regra de autorização (antigo `architecture.md`) |
| `changes.md` | Plano por fase com o fechamento de cada uma (antigo `plan.md`) |
| `notes.md` | Log da sessão |
| `files-changed.txt` | Arquivos alterados em relação à `main` |
| `commands-executed.txt` | Como validar |

## Pendências que saem daqui

- Confirmar com a GMill que `branch_ids` do token são **códigos de filial** e que catálogos globais
  são editáveis por qualquer admin.
- No E3+: validar respostas reais contra o OpenAPI (Ajv) e testar carga com volume.
- Próximo épico: E3, cadastro de carteira (OG1-T4).
