# E3 — Cadastro de carteira (arquivado)

- **Branch:** `feature/carteira-e3-cadastro-carteira` → `main`
- **Task:** OG1-T4 (Zoho, subtask de OG1-T1) · **Período:** 2026-10-08

## Resumo executivo

O E3 entregou a carteira de clientes como agregado editável por etapa do wizard: informações, filtros
(regiões por UF, município ou bairro, redes e grupos, com vários valores por critério), vendedores ×
subgrupos e resumo. A API `/v1/portfolios` tem permissões por dono (admin da filial ou responsável),
versão única no agregado e ciclo rascunho → ativa (a ativação fica para o E7). O motor de
elegibilidade (E4) passa a ter os filtros sobre os quais operar.

## Números

- 395 testes na API e 22 no web; smoke do wizard verde 3 vezes no Compose.
- Revisão: nenhum achado alto; 2 médios e 7 baixos curados (`632a925`).

## Decisões

- **Do maestro:** responsável = `sub` do login; filtros com OU dentro de cada critério e E entre
  critérios; o admin cria e o responsável edita a sua; rascunho → ativa no E7, com inativação.
- **Do orquestrador, declaradas ao maestro:** nome insensível a pontuação; carteira inativa não aceita
  edição; um vendedor sem vínculo não bloqueia a reativação.

## Arquivos deste registro

`context.md` (decisões), `decisions.md` (arquitetura, com as correções), `changes.md` (plano por fase),
`notes.md` (log), `files-changed.txt` e `commands-executed.txt`.

## Pendências que saem daqui

- No E8: leitura por perfil, para que o vendedor veja só as carteiras em que atua. Depende de ligar o
  `sub` do login a um vendedor.
- Próximo épico: E4, motor de elegibilidade (OG1-T5).
