# Contexto — carteira-e4-elegibilidade

- **Branch**: feature/carteira-e4-elegibilidade
- **Base**: main (`135318a`)
- **Task vinculada**: OG1-T5 · `2723266000000151012` (zoho) — E4, subtask de OG1-T1; 8 story points
- **Criada em**: 2026-10-08
- **Condução**: `/meta:drive` com aprovações automáticas do orquestrador (autorizado pelo maestro em
  2026-10-08). Cada decisão abaixo está marcada **[auto]** e declarada ao maestro. Merge sempre humano.
- **Objetivo**: o motor de elegibilidade. Ele cruza os filtros da carteira (E3) com os cadastros (E2)
  para montar a **prévia revisável** dos clientes, com inclusão e exclusão manuais. É a etapa 5 do
  wizard ("Clientes"), antes de conflitos (E5), distribuição (E6) e finalização (E7).

## Por que

O documento diz: "Os filtros ajudam a sugerir clientes. A prévia pode ser revisada, e clientes também
podem ser incluídos manualmente" (`docs/business-context/02-product/features/carteira-de-clientes.md`).
Sem o motor, a carteira tem critérios mas não tem clientes.

## Decisões [auto] — orquestrador, 2026-10-08

| Tema | Decisão | Por quê |
|---|---|---|
| Prévia | **Calculada sob demanda**, não materializada. O que persiste são os **ajustes manuais** (inclusões e exclusões). A materialização dos vínculos é do E7. | Os cadastros mudam: uma prévia gravada envelheceria. A regra fica num lugar só. |
| Elegível por filtro | Cliente **ativo** + vínculo **ativo** com a filial da carteira + casa com os filtros: **OU dentro** de cada critério, **E entre** os critérios preenchidos (decisão do E3). | É o que o documento e o E3 definem. |
| Região | Casa se casar com **qualquer** entrada: UF (`state_code`), município (`municipality_code`) ou bairro (município + `neighborhood_key`). Expõe o **nível mais específico** que casou. | O E5 usa esse nível para a prioridade (bairro > cidade > estado). |
| Carteira sem filtro | A prévia mostra **só as inclusões manuais**. | É coerente com a decisão `[INFERIDO]` do E3. |
| Inclusão manual | Adiciona um cliente que **não casa** os filtros. Ele precisa estar ativo e ter vínculo ativo com a filial. | "Clientes também podem ser incluídos manualmente." |
| Exclusão manual | Remove da prévia um cliente que **casa** os filtros. | É a "revisão" da prévia. |
| Inclusão × exclusão | São mutuamente exclusivas por cliente: gravar uma substitui a outra. | Um cliente não pode estar ao mesmo tempo dentro e fora. |
| Permissão | Ler a prévia segue a leitura da carteira (E3). Gravar ajustes segue a edição: admin da filial ou o responsável, com carteira ativa (`portfolio_inactive`), `If-Match` e versão do agregado. | É o modelo do E3. |
| Conflitos | **Não** são calculados no E4. A prévia traz o nível que casou, que o E5 usa. | Escopo do E5. |
| Volume | Meta de 50 mil clientes (decisões de trabalho): **uma consulta SQL** com `EXISTS`, paginada por cursor, e medição com volume sintético. | Desempenho é risco declarado desde o E2. |

## Resultado esperado

- `GET /v1/portfolios/{id}/preview?cursor=&limit=&q=&source=` devolve a página da prévia: o cliente
  (só dado de empresa), a origem (`filter` ou `manual`), o nível de região que casou e quais critérios
  casaram. Traz também o total.
- `GET /v1/portfolios/{id}/overrides` lista as inclusões e exclusões manuais.
- `PUT /v1/portfolios/{id}/overrides` substitui o conjunto `{ include: [customerId], exclude: [customerId] }`,
  como as outras seções do E3.

## Fora do escopo

Conflitos entre carteiras e bloqueio por empate (E5), distribuição (E6), finalizar e gravar vínculos
(E7), visibilidade fina (E8), tela (E9) e arquivo (E10).

## Riscos

1. **Desempenho com 50 mil clientes:** medir com volume sintético e `EXPLAIN QUERY PLAN`. Se precisar,
   criar índices.
2. **Exclusão de um cliente que deixou de casar:** o ajuste fica gravado, mas não tem efeito. A prévia
   ignora, e a listagem de ajustes marca como "sem efeito" (`effective: false`).

## 📋 Phase-Subtask Mapping
- **Phase 1**: "Schema dos ajustes e motor de elegibilidade" → Subtask ID: 2723266000000151012
- **Phase 2**: "Prévia e ajustes no domínio" → Subtask ID: 2723266000000151012
- **Phase 3**: "API da prévia e dos ajustes" → Subtask ID: 2723266000000151012
- **Phase 4**: "OpenAPI, smoke, docs e revisão" → Subtask ID: 2723266000000151012
