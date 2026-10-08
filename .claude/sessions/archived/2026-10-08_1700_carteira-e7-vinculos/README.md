# E7 — Ciclo de vida dos vínculos (arquivado)

- **Branch:** `feature/carteira-e7-vinculos` (empilhada sobre o E6) · **Task:** OG1-T8 · 2026-10-08 · /meta:drive E5–E7

Finalizar grava vínculos carteira × cliente × subgrupo × vendedor (carteira completa e sem bloqueados), com histórico que nunca é apagado e outbox de eventos lida por cursor. Re-finalizar faz o diff. Um vínculo ativo por (filial, cliente, subgrupo). Tomada de vínculo da carteira que perdeu a disputa. Inativação, transferência e mudanças de cadastro encerram vínculos. Volume: 150 mil vínculos + 150 mil eventos em ~1,4 s.

Arquivos: `context.md`, `decisions.md`, `changes.md`, `notes.md`, `files-changed.txt`.
