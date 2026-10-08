---
updated: 2026-10-08
source: apps/api/src/routes/v1/csv.ts, apps/api/src/domain/csv/, apps/api/drizzle/0012_e10_import_jobs.sql, apps/api/test/domain/csv-import.test.ts, apps/api/test/domain/csv-export.test.ts, apps/api/test/domain/csv-volume.test.ts, apps/api/test/routes/csv.test.ts, scripts/smoke.sh, .claude/sessions/carteira-e10-csv/context.md
---

# API de importação e exportação CSV (v1)

Escopo: `apps/api` (MeuGmill Vendas, carteira de clientes), E10. Cobre a carga inicial e a manutenção em lote
dos cadastros mestres, das carteiras (cabeçalho e filtros) e dos vínculos, e a exportação no mesmo layout. As
telas ficam no E9. O contrato completo está em [`openapi-v1.json`](./openapi-v1.json); convenções comuns em
[`api-dados-mestres.md`](./api-dados-mestres.md).

## Formato

[INFERIDO] É o default proposto em 2026-10-07 e ainda não foi validado com a GMill. Os nomes de coluna ficam
todos em `domain/csv/layouts.ts`.

- **UTF-8**: com ou sem BOM na entrada e sempre com BOM na saída, para o Excel em pt-BR abrir direto.
  Arquivo em Latin-1 é recusado (`Arquivo não está em UTF-8`).
- Separador **`;`**, aspas `"` com `""` de escape (RFC 4180) e cabeçalho na 1ª linha. Na entrada vale CRLF ou
  LF, e a saída usa CRLF. Aspas no meio de um campo sem aspas são texto, como no Excel.
- **Listas** dentro de um campo vêm separadas por `|`. Booleano é `S` ou `N`, e vazio vale `S`.
- Cabeçalhos em pt-BR, `snake_case`, sem acento, **em qualquer ordem**. Uma coluna desconhecida, repetida ou
  obrigatória ausente invalida o arquivo. Colunas só de leitura (`uf` dos clientes, `situacao` das carteiras)
  são aceitas e ignoradas na importação.
- **Proteção de fórmula** (OWASP CSV injection): na saída, um valor que começa com `=`, `+`, `-`, `@`, tab ou
  CR recebe `'` na frente; na entrada, esse `'` é retirado. A volta do arquivo continua idempotente.
- Limites: 16 MB, 100 mil linhas de dados e 4.000 caracteres por campo.

## Layouts

O dicionário de dados de cada layout (colunas, tipo, obrigatoriedade, descrição e exemplo) sai em
`GET /v1/csv-layouts` e em `GET /v1/csv-layouts/{layout}`.

| Layout                                                    | Chave natural                                             | Colunas                                                                                                              | Observação                                                                                                                                   |
| --------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `branches`                                                | `codigo`                                                  | `codigo;nome;municipio_ibge;ativo`                                                                                   | Criar exige o código no token.                                                                                                               |
| `product-subgroups`, `retail-networks`, `economic-groups` | `codigo`                                                  | `codigo;nome;ativo`                                                                                                  | O código não muda.                                                                                                                           |
| `sellers`                                                 | `codigo`                                                  | `codigo;nome;filiais;ativo`                                                                                          | Sem `userSub` (minimização); a ligação com o login é pela API.                                                                               |
| `customers`                                               | `cnpj`                                                    | `cnpj;razao_social;nome_fantasia;uf;municipio_ibge;bairro;rede_codigo;grupo_economico_codigo;filiais;ativo`          | Sem CPF. A UF vem do município.                                                                                                              |
| `portfolios`                                              | `filial_codigo` + `nome`                                  | `filial_codigo;nome;tipo_codigo;responsavel_sub;descricao;regioes;redes;grupos_economicos;vendedores;situacao;ativo` | O nome casa pela chave normalizada do E3. `regioes`: `UF`, `UF/município` ou `UF/município/bairro`. `vendedores`: pares `subgrupo:vendedor`. |
| `links`                                                   | `filial_codigo` + `carteira` + `cnpj` + `subgrupo_codigo` | `filial_codigo;carteira;cnpj;subgrupo_codigo;vendedor_codigo`                                                        | Conjunto **completo** de cada carteira citada.                                                                                               |

`filiais` é o conjunto desejado **entre as filiais do usuário**. As outras filiais do cadastro não mudam,
como no PATCH do E2.

## Regras da importação

- **Os mesmos serviços da API.** Cada linha passa pelo serviço de domínio do E2–E8, com validação, escopo de
  filial, permissão (só o admin escreve), auditoria e encerramento de vínculos. Não existe caminho paralelo
  de escrita.
- **Upsert pela chave natural.** Uma chave inexistente cria (`create`). Uma chave existente atualiza só o que
  difere (`update`). Sem diferença, a linha fica `unchanged`: nada é gravado e a versão não muda. A coluna
  `ativo` inativa ou reativa (`activation`) nas filiais do usuário. Uma carteira inativa é reativada antes de
  ser editada.
- **Cadastro existente fora do escopo** (CNPJ ou código de vendedor em outras filiais): a linha só liga o
  cadastro às filiais do arquivo, pelo caminho do E2, sem alterar os dados. Sai como `linked`, com aviso, e o
  `ativo=N` vale para o vínculo recém-feito. Uma reimportação dessa linha com dados **diferentes** falha
  (`forbidden`): mudar dados compartilhados exige todas as filiais do cadastro no token, como no PATCH do E2.
- **Filial da carteira antes de tudo.** Em carteiras e vínculos, a filial precisa estar no token antes de
  qualquer busca. Filial inexistente e filial fora do escopo dão a mesma resposta. Nos vínculos, um CNPJ sem
  cadastro e um cliente de outra filial recebem a mesma mensagem do E6 (`Cliente não é membro efetivo da
carteira`). Assim a simulação não revela o que existe fora do escopo.
- **Separadores.** Um código do ERP não aceita `|` nem `:`, e o rótulo de bairro de uma região não aceita
  `|`. A regra vale no domínio (E2/E3), porque com esses caracteres o valor não voltaria igual de uma
  exportação.
- **Vínculos.** Cada carteira citada é uma unidade. A importação troca as atribuições (E6), com set e clear
  em lotes de 5.000, e **finaliza** a carteira (E7), passando pela prévia (E4), pelos conflitos (E5) e pela
  grade completa. Se algo falha, a carteira inteira falha. O erro de uma atribuição aponta a linha dela, e as
  outras linhas recebem `Carteira não gravada: outra linha dela tem erro`. As contagens trazem `linksEnded`
  (vínculos que saíram da carteira), `linksTakenOver` e `portfoliosFinalized`. Uma carteira que toma
  clientes de outra no mesmo arquivo grava igual à simulação, porque a simulação é cumulativa.
- **Linhas repetidas** (mesma chave natural) falham todas com `duplicate_key`. Uma linha com número de campos
  diferente do cabeçalho falha com `malformed_row`.

## Ciclo do job

```
POST /v1/imports?layout=…  ──202──▶ validating ──▶ validated ──POST confirm (202)──▶ applying ──▶ applied
                                         │              │                                   └──▶ partially_applied
                                         └──▶ invalid   ├──POST cancel──▶ cancelled
                                                         └──24 h──▶ expired
     (subida ou desligamento da API com job aberto ──▶ interrupted · erro inesperado ──▶ failed)
```

- **Simulação.** As escritas reais dos serviços rodam numa **cópia do banco**, feita no início com o `backup` do SQLite (por páginas, cedendo a vez entre os passos) em `import-sim/`, ao lado do arquivo do banco (mesmo volume e mesma retenção), apagada no fim e, se o processo morrer, na subida seguinte. Os blocos são cumulativos: cada um vê o efeito dos anteriores, como na gravação. O banco real não fica travado, e o relatório traz o que a gravação faria. O job termina `validated` sem nenhum erro e `invalid` com algum erro, ou com erro de arquivo em `fileError` (mensagem e linha).
- **Confirmação.** Só vale para um job `validated` sem erros e do próprio usuário, dentro do prazo de 24 h e
  com o **mesmo escopo de token** da simulação: mesmos papéis e mesmas filiais. Outro escopo mudaria o
  resultado, por exemplo de `linked` para `update`, e responde `409 import_not_ready`. A gravação usa
  transações próprias em blocos de até 200 linhas ou 50 ms (uma unidade nunca é partida), com os dados e o
  relatório do bloco na mesma transação. Entre os blocos a API atende outras requisições. Uma linha falha sem
  sobrescrever em dois casos: se o registro mudou depois da simulação (`version_conflict`) ou se a ação ou a
  ativação saíram diferentes do simulado (`changed_since_validation`). O job então termina
  `partially_applied`. Numa carteira de vínculos desfeita na confirmação, todas as linhas dela saem `failed`. Desligar a API no meio da gravação termina `partially_applied` se algum bloco já entrou (o relatório diz quais linhas), e `interrupted` se nenhum entrou.
- **Vencimento.** Uma varredura a cada 10 minutos, e também a cada envio, faz a simulação vencida virar
  `expired` e tira o arquivo da memória, mesmo que ninguém leia o job.
- **Assíncrono.** Há uma fila serial por processo (SQLite, instância única). `POST /v1/imports` e
  `POST /confirm` respondem `202`; o progresso está em `GET /v1/imports/{id}` (`processedRows`, `errorRows`,
  `counts`).
- **Relatório.** `GET /v1/imports/{id}/lines?status=invalid|valid|applied|failed` vem paginado por linha, com
  até 1.000 itens. Cada item traz a linha, o status, a ação (`create`, `update`, `unchanged`, `linked`), a
  ativação, o código e a mensagem fixa do domínio. A mensagem **nunca** ecoa o valor enviado.
- **Acesso.** Importar é só do `admin`. Supervisão e vendedor recebem `403` no `onRequest`, **antes** de a
  API ler o corpo. O parser de `text/csv` com limite de 16 MB vale só na rota de envio. O job é visível só a
  quem o criou: outro `sub` recebe `404`. Cada usuário tem no máximo 5 jobs abertos e 48 MB de arquivos abertos, e o serviço guarda no máximo 256 MB (`too_many_imports`). Confirmar ou cancelar fora do estado responde
  `409 import_not_ready`.

## Exportação

`GET /v1/exports/{layout}` devolve `text/csv; charset=utf-8` com BOM e `Content-Disposition: attachment`. O
arquivo é gerado na hora, em streaming, página a página, pelas listagens dos serviços. Assim ele traz
exatamente o que o usuário leria pela API, com escopo de filial e visibilidade do E8: o vendedor só exporta
os clientes visíveis a ele, e os vínculos saem só das carteiras cuja leitura o perfil permite. Reimportar o
arquivo exportado sem editar dá tudo `unchanged` (teste de ida e volta nos 8 layouts). As páginas são lidas
uma a uma, sem transação de leitura: uma edição no meio da exportação pode aparecer só em parte. Um erro no
meio encerra o download truncado.

## LGPD e auditoria

- O **conteúdo do arquivo nunca vai para o banco** (nem para o WAL ou as páginas livres do SQLite). Ele fica
  só na memória do processo enquanto o job está aberto e sai dela quando o job termina: gravado, inválido,
  cancelado, vencido, interrompido ou com falha. Se a API reinicia, os jobs abertos viram `interrupted` e o
  arquivo precisa ser reenviado.
- `import_jobs` guarda quem, quando, o layout, o **SHA-256** e o tamanho do arquivo, os papéis e as filiais do
  token da simulação (sem dado pessoal), as contagens, o estado e quem confirmou.
- `import_job_lines` guarda o nº da linha, a ação, o código, a mensagem fixa e o alvo (id e versão) visto na
  simulação, **nunca** o conteúdo da linha.
- Os logs registram só o id do job e o tipo do erro.
- Nenhum layout tem CPF, e-mail, telefone nem o `userSub` do vendedor. A coluna `responsavel_sub` das
  carteiras é o mesmo identificador opaco do login do responsável que a API do E3 já expõe.

## Desempenho

Cada linha passa pelos serviços de domínio, o que custa cerca de 1,2 ms por linha em cada fase. Medido com
**50 mil clientes** (a meta de dimensionamento) em `pnpm --filter @meugmill/api test:perf`:

- a simulação e a gravação levam cerca de 1 minuto cada;
- o atraso do event loop tem **p99 de cerca de 80 ms**, com teto de 150 ms no teste;
- o máximo isolado oscilou de 240 ms a 1,2 s em execuções iguais, numa máquina compartilhada. Ele é um bloco
  de até 50 ms somado a pausas de GC de até cerca de 190 ms, e por isso só vai para o log.

A leitura do arquivo, a pré-validação e a carga do relatório cedem a vez a cada fatia (1 milhão de caracteres
ou 20 mil registros na leitura; 10 mil linhas no resto). Um campo gigante é recusado durante a leitura. A cópia do banco para a simulação é feita por páginas (cerca de 4 MB por passo), cedendo a vez entre os passos, então o tamanho do banco não trava a API.

**Exceção: vínculos.** A carteira é uma unidade e nunca é partida. Uma carteira grande segura a API pelo tempo
da troca de atribuições e da finalização, cerca de 2,3 s com 10 mil células. É o mesmo custo de finalizar a
carteira pela API (E7).

A suíte normal roda mil linhas e confere só o resultado. A exportação lê pelas listagens paginadas (200 por
página).

## Riscos

1. **A gravação em blocos não é atômica no arquivo inteiro.** Uma falha no meio deixa os blocos anteriores
   gravados. O relatório mostra o que entrou, linha por linha e na mesma transação dos dados. Reimportar o
   mesmo arquivo dá `unchanged` nas linhas já gravadas, menos nas linhas `linked` com dados diferentes (ver
   acima).
2. **O layout é o default proposto** e não foi validado com a GMill.
3. A fila e os arquivos abertos são **do processo**. Com mais de uma instância da API, seria preciso uma
   fila compartilhada, o que vai junto com a troca para PostgreSQL.
4. **Carteira grande nos vínculos** segura a API pelo tempo da finalização (ver Desempenho).
5. A simulação ocupa, enquanto roda, **o tamanho do banco em disco**, no mesmo volume do banco (16 MB com 50 mil clientes).
6. A regra nova de código (sem `|` nem `:`) vale para os dados novos. Um código antigo com esses caracteres não volta a ser aceito no vínculo por código e faz a exportação falhar no meio do download. Ainda não há dado de produção; conferir antes da carga inicial.
