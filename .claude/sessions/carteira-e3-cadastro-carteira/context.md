# Contexto — carteira-e3-cadastro-carteira

- **Branch**: feature/carteira-e3-cadastro-carteira
- **Base**: main (`698b2a7`)
- **Task vinculada**: OG1-T4 · `2723266000000145015` (zoho) — E3, subtask de OG1-T1; 8 story points
- **Criada em**: 2026-10-08
- **Objetivo**: cadastro da carteira, que cobre as etapas 1 a 4 do wizard: informações, filtros, vendedores × subgrupos e resumo. É sobre ele que o motor de elegibilidade (E4) vai trabalhar.

## Por que

A carteira organiza quais clientes cada vendedor atende, por filial
(`docs/business-context/02-product/features/carteira-de-clientes.md`). O E2 entregou os cadastros
mestres. O E3 entrega a carteira em si: o que ela é, quais critérios ela usa para achar clientes e quem
atende quais subgrupos. A prévia de clientes, os conflitos, a distribuição e os vínculos cliente ×
vendedor ficam para o E4 ao E7.

## Decisões (maestro, 2026-10-08)

| Tema | Decisão |
|---|---|
| Responsável | **Usuário do IdP**: a carteira guarda só o `sub` do responsável, sem nome nem e-mail (LGPD). Quem exibe o nome é o sistema principal. |
| Filtros | Cada critério aceita **vários valores**: o cliente casa com **algum** valor (OU) de **cada** critério preenchido (E). Bairro exige a cidade. |
| Permissão | **Admin** da filial cria e edita qualquer carteira da filial. O **responsável** edita só a carteira dele. Os demais só leem. |
| Ciclo de vida | Nasce **rascunho**. A ativação ("finalizar") entra só no **E7**, junto com os vínculos. **Inativar** em vez de excluir, como no E2. |

## Defaults que assumo (marcar `[INFERIDO]` quando relevante)

- **Tipo de carteira** é um catálogo `code + name` (`portfolio_types`), reaproveitando a fábrica de
  catálogos do E2. O tipo só classifica e não muda regra (decisões de trabalho).
- **Região** é uma lista de entradas, cada uma num nível: **UF**, **município** (que precisa ser da UF
  da entrada) ou **bairro** (município + `neighborhood_key`). Um cliente casa com a região se casar com
  alguma entrada. O nível da entrada que casou é o que o E5 vai usar para a prioridade (bairro > cidade
  > estado).
- **Rede** e **grupo econômico**: listas de ids existentes e ativos.
- **Carteira sem nenhum filtro é permitida**, para quem monta só com inclusão manual (E4). `[INFERIDO]`
- **Vendedores × subgrupos**: um conjunto de pares (vendedor, subgrupo). O vendedor precisa ter
  vínculo **ativo** com a filial da carteira, e o subgrupo precisa estar ativo. Um vendedor pode ter
  vários subgrupos e um subgrupo pode ter vários vendedores (a distribuição do E6 divide entre eles).
- **Nome** único por filial, mesmo entre carteiras inativas.
- **Filial e responsável**: só o admin altera. O responsável não pode transferir a carteira nem mudar
  a filial dela.
- **Leitura**: qualquer autenticado lê as carteiras das filiais do token. O refinamento por perfil
  ("vendedor só vê as carteiras em que atua") depende de ligar o `sub` do token a um vendedor, o que
  ainda não existe, e fica para o E8. `[INFERIDO]`
- **Forma da API**: o agregado é editado por seções, uma por etapa do wizard: `POST` cria o rascunho
  com as informações, `PATCH` altera as informações, `PUT /filters` e `PUT /sellers` substituem cada
  conjunto inteiro, e `GET` devolve o agregado completo, que é o resumo. Todas as escritas usam
  `If-Match`.

## Fora do escopo

Prévia e inclusão manual de clientes (E4), conflitos (E5), distribuição (E6), finalizar e gravar
vínculos (E7), visibilidade fina por perfil (E8), telas (E9) e arquivos (E10).

## Riscos

1. **Mudança de filial de uma carteira com vendedores e filtros já definidos.** A regra proposta: o
   admin só troca a filial se o conjunto de vendedores for compatível com a filial nova. Senão, 400.
2. **Vendedor perde o vínculo com a filial depois de entrar na carteira.** O E3 valida só na escrita.
   O E6 e o E7 tratam o vendedor inativo na hora de distribuir.

## Como testar

O padrão do E2: testes de domínio sem HTTP, contrato HTTP com JWT por perfil e filial, e smoke no
Compose com o fluxo criar rascunho → filtros → vendedores → resumo.

## 📋 Phase-Subtask Mapping
- **Phase 1**: "Schema e migration da carteira" → Subtask ID: 2723266000000145015
- **Phase 2**: "Domínio da carteira" → Subtask ID: 2723266000000145015
- **Phase 3**: "API da carteira e do tipo" → Subtask ID: 2723266000000145015
- **Phase 4**: "OpenAPI, smoke, docs e revisão" → Subtask ID: 2723266000000145015

> O E3 não tem subtasks no Zoho; todas as fases apontam para a própria OG1-T4.
