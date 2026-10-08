# E4 — Motor de elegibilidade (arquivado)

- **Branch:** `feature/carteira-e4-elegibilidade` → `main`
- **Task:** OG1-T5 (Zoho, subtask de OG1-T1) · **Período:** 2026-10-08
- **Condução:** `/meta:drive` com aprovações automáticas do orquestrador (autorizadas pelo maestro); merge humano.

## Resumo executivo

O E4 entregou a etapa "Clientes" do wizard. A prévia, calculada sob demanda, cruza os filtros da
carteira (E3) com os cadastros (E2). Os ajustes manuais (inclusão e exclusão) ficam gravados. Cada item
traz a origem (`filter` ou `manual`), o nível de região mais específico que casou (para a prioridade do
E5) e quais critérios casaram.

## Números

- 457 testes na API e 22 no web; smoke da prévia verde no Compose.
- 50 mil clientes: primeira página com total em cerca de 165 ms; pior caso em cerca de 62 ms.
- Revisão: 1 achado ALTO (vazamento de escopo) reproduzido, curado e confirmado por verificação
  adversarial; 1 médio e 6 baixos curados.

## Decisões [auto] (ver context.md)

Prévia sob demanda; elegível = cliente ativo + vínculo ativo + OU dentro de cada critério e E entre
critérios; inclusão e exclusão mutuamente exclusivas; inclusão manual sem nível de região; ajustes só de
clientes com vínculo com a filial da carteira; órfãos descartados.

## Arquivos deste registro

`context.md`, `decisions.md` (arquitetura), `changes.md` (plano), `notes.md`, `files-changed.txt` e
`commands-executed.txt`.

## Pendências que saem daqui

- Observar o desempenho se o volume passar de algumas centenas de milhares de clientes (o plano faz
  `SCAN` por PK).
- Próximo épico: E5, resolução de conflitos entre carteiras (OG1-T6). Ele consome
  `matchedRegionLevel`.
