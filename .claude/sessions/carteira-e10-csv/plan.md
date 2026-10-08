# Plano — carteira-e10-csv

> Marcadores: `[ACTIVE]` / `[TODO]` / `[DONE]`. Zoho: OG1-T11.

## Fase 1 — Codec CSV e layouts com dicionário [DONE]

- [x] `domain/csv/codec.ts`: parse estrito (UTF-8, BOM opcional, `;`, aspas, CRLF ou LF, limites) e escrita (BOM, CRLF, aspas, proteção contra fórmula)
- [x] `domain/csv/layouts.ts`: colunas por layout (nome, obrigatória, tipo, descrição, exemplo) e validação de cabeçalho
- [x] Testes do codec e dos cabeçalhos

## Fase 2 — Jobs de importação: simulação, confirmação e relatório [DONE]

- [x] Migração `import_jobs` + `import_job_lines`
- [x] Aplicadores por layout sobre os serviços de domínio (upsert por chave natural, `unchanged`, ativo)
- [x] Runner serial: simulação em transação desfeita, confirmação em blocos com checagem de versão, `interrupted` na subida, expiração em 24 h, conteúdo apagado ao terminar
- [x] Testes por layout e de estado do job; volume (50 mil clientes)

## Fase 3 — Exportação, API, smoke, docs e revisão [ACTIVE]

- [x] Exportadores por layout (listagens paginadas dos serviços; ida e volta idempotente)
- [x] Rotas `/v1/csv-layouts`, `/v1/imports`, `/v1/exports/:layout`; parser `text/csv`; OpenAPI
- [ ] Smoke; `docs/technical-context/api-csv.md`; revisão; PR
