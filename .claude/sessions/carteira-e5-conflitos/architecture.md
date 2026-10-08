# Arquitetura — carteira-e5-conflitos

> Decisões em [context.md](context.md). Base: o motor do E4 (`domain/eligibility/query.ts`: um único
> SQL que dá candidatos por filtro, `matchedRegionLevel`, `matchedBy` e ajustes) e o E3 (carteiras com
> `status` e `active` e filial).

## 1. Posto de uma carteira para um cliente

```
rank(P, c) =  6  se c ∈ inclusões manuais de P (e válido)
           =  max( 5·byEconomicGroup, 4·byRetailNetwork, nivel(matchedRegionLevel) )  se c é candidato por filtro em P
              nivel: neighborhood=3, municipality=2, state=1, null=0
           =  sem posto (não concorre) se c ∈ exclusões de P ou não é elegível em P
```

O posto é calculado pela **mesma expressão SQL** do motor do E4, generalizada por carteira. Ela é
extraída para uma função que recebe a carteira como coluna, e não como parâmetro, para não duplicar a
regra de casamento.

## 2. Resolução

Para cada cliente `c` com posto `r` em `P`, e com as carteiras concorrentes `Q` da mesma filial (não
inativas, `Q ≠ P`) em que `c` tem posto:
- `assigned` se não há concorrente, ou se `r` > o posto de todos os concorrentes;
- `lost` se algum concorrente tem posto maior que `r`;
- `blocked` se `r` é o maior e algum concorrente empata nele.

## 3. Implementação

- `domain/conflicts/query.ts`: dada a filial e uma lista de ids de clientes (a página), calcula em
  **uma consulta** os postos de cada cliente em **todas** as carteiras não inativas da filial.
- **Prévia (E4) com resolução:** o filtro `resolution` e o total exigem resolver o conjunto inteiro. A
  forma escolhida é uma CTE com os postos por (carteira, cliente) restrita aos clientes da filial,
  agregada por cliente: `max` dos postos dos concorrentes e contagem de empate. A página e o total saem
  dessa CTE.
- **Medição:** se 50 mil clientes com 20 carteiras passarem do teto (1,5 s), a alternativa é um cache
  por requisição. Não haverá materialização persistente sem nova decisão.

## 4. Contrato

`GET /v1/portfolios/{id}/preview?resolution=assigned|lost|blocked`. O item ganha
`resolution` e `competitors: [{ portfolioId, name, rank }]`. Um item `manual` também concorre, com
posto 6. As contagens `conflictsBlocked` e `conflictsLost` vêm **só sob demanda**, com
`GET /v1/portfolios/{id}?include=conflicts`.

> **Corrigido em 2026-10-08, após a revisão.** A primeira versão punha as contagens em todo agregado,
> inclusive nas respostas de escrita, e resolvia a disputa inteira de forma síncrona (5,5 a 32 s no pior
> caso). Depois da otimização (filial nos braços, concorrentes restritas aos membros de P, prévia sem
> filtro pelo caminho do E4), a meta (20 carteiras + 200 mil clientes de outra filial) fica em
> 0,75–0,8 s. Com **100 carteiras** sobrepostas, fica em 2,3–2,6 s, acima do teto de 1,5 s.
> **Aceito pelo maestro como risco registrado**, com cache por filial como melhoria futura.

## 5. Fases

1. Motor de conflitos + prévia com resolução (domínio), com testes de regra e de volume.
2. API, OpenAPI, smoke, docs e revisão em paralelo.
