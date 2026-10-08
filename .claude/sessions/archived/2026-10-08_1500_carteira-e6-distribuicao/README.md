# E6 — Distribuição de clientes (arquivado)

- **Branch:** `feature/carteira-e6-distribuicao` (empilhada sobre o E5) · **Task:** OG1-T7 · 2026-10-08 · /meta:drive E5–E7

Atribuição cliente × subgrupo → vendedor (um vendedor por cliente por subgrupo, pela PK), só para membros efetivos do E5. Manual em lote (set/clear) e automático balanceado e determinístico (preenche só o que falta). Células assigned/unassigned/stale. `loadAssignmentGrid` entrega a grade inteira ao E7. Volume: distribute de 150 mil linhas em ~0,74 s.

Arquivos: `context.md`, `decisions.md`, `changes.md`, `notes.md`, `files-changed.txt`.
