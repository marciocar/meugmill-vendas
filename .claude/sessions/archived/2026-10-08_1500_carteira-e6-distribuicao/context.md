# Contexto — carteira-e6-distribuicao

- **Branch**: feature/carteira-e6-distribuicao (**empilhada sobre** `feature/carteira-e5-conflitos`)
- **Task vinculada**: OG1-T7 · `2723266000000151014` (zoho) — E6; 8 story points
- **Criada em**: 2026-10-08 · **Condução**: `/meta:drive` E5–E7 (aprovações automáticas; merge humano em lote)
- **Objetivo**: distribuir os clientes atribuídos à carteira (`assigned` do E5) entre os vendedores de
  cada subgrupo, à mão ou automaticamente, com um único vendedor por cliente em cada subgrupo. As
  atribuições ficam como **rascunho**: virar vínculo é trabalho do E7.

## Regra (documento)

"O responsável pode escolher um vendedor para cada cliente ou usar a distribuição automática. A
distribuição automática divide os clientes entre os vendedores disponíveis em cada subgrupo. Um mesmo
cliente pode ser atendido por vendedores diferentes em subgrupos diferentes. Dentro do mesmo subgrupo,
porém, só pode haver um vendedor responsável pelo cliente."

## Decisões [auto] — orquestrador, 2026-10-08

| Tema | Decisão | Por quê |
|---|---|---|
| Unidade | Atribuição = (carteira, cliente, subgrupo) → vendedor. A PK (carteira, cliente, subgrupo) garante **um vendedor por cliente por subgrupo**. | É a invariante do documento, garantida pelo banco. |
| Subgrupos da carteira | Os subgrupos são os dos pares vendedor × subgrupo do E3 (`portfolio_sellers`). Cada cliente atribuído precisa de um vendedor **em cada um** deles para a carteira estar completa (exigência do E7). | O E3 define quem atende o quê. |
| Validade | Cliente é membro efetivo (`assigned` do E5); o par (vendedor, subgrupo) está na carteira; o vendedor está ativo e tem vínculo ativo com a filial. Uma atribuição que perde a validade (cliente perdeu a disputa, par removido, vendedor inativado) fica gravada como **`stale`** e é ignorada. | Mesmo padrão dos ajustes do E4 (`effective`): nada some sem rastro. |
| Manual | `PUT /assignments` em **lote parcial**: `{ set: [{customerId, productSubgroupId, sellerId}], clear: [{customerId, productSubgroupId}] }`, com `If-Match` e versão do agregado. Até 5.000 itens por chamada. | Com milhares de clientes, substituir tudo a cada ajuste seria inviável. |
| Automático | `POST /distribute { productSubgroupIds? }` preenche **só quem está sem vendedor válido** (preserva o que existe). Em cada subgrupo, o cliente vai para o vendedor com **menos** clientes. O empate é decidido pelo **código do vendedor**, e os clientes seguem em ordem de id. É **determinístico** e a estratégia fica **isolada**, para trocar por rodízio ou faturamento. | Decisões de trabalho (equilíbrio por quantidade, determinístico). |
| Leitura | `GET /assignments` paginado (filtros `productSubgroupId`, `sellerId`, `status = assigned\|unassigned\|stale`) e `GET /assignments/summary` (por subgrupo: contagem por vendedor, sem vendedor e stale). | A tela e o E7 precisam ver o que falta. |
| Permissão | Ler segue a leitura da carteira. Escrever (manual ou automático) segue a edição do E3: admin ou responsável, carteira não inativa (`portfolio_inactive`), `If-Match`. | Modelo do E3. |
| Desempenho | Meta: 50 mil membros × 3 subgrupos. O `distribute` grava até 150 mil linhas em uma transação. Teto: `distribute` ≤ 5 s, página ≤ 1,5 s, `summary` ≤ 1,5 s. Medido no `test:perf`. | Escrita em massa é síncrona e bloqueia o event loop: precisa ser medida. |

## Fora do escopo

Finalizar e gravar os vínculos, com histórico e outbox (E7). Tela (E9).

## 📋 Phase-Subtask Mapping
- **Phase 1**: "Atribuições: schema, domínio e distribuição automática" → Subtask ID: 2723266000000151014
- **Phase 2**: "API, smoke, docs e revisão" → Subtask ID: 2723266000000151014
