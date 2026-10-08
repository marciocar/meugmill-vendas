# E9 — Front embarcável: wizard e telas de CSV (arquivado)

- **Branch:** `feature/carteira-e9-wizard` · **Task:** OG1-T10 · 2026-10-08 · /meta:drive E8–E10 (último épico)

O `<gmill-carteira>` ganhou a lista de carteiras e o wizard de 5 etapas (Informações, Filtros, Vendedores, Resumo e Clientes, com prévia e ajustes, distribuição e finalização), as telas de CSV do E10 e "Meus clientes" do E8. A API passou a aceitar `If-Match` no CORS, e o nginx passou a aceitar CSV de até 16 MB. A revisão adversarial teve 3 passadas e APROVOU na 3ª; o teste no navegador real rodou num Chromium headless contra o Compose.

Arquivos: `context.md` (decisões, inclusive as revistas) e `files-changed.txt`. Documentação: `docs/technical-context/front-web.md`; resíduo: `docs/evolution/review/feature-carteira-e9-wizard.md`.
