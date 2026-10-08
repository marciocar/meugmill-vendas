# Contexto — carteira-e10-csv

- **Branch**: feature/carteira-e10-csv (base: main `56c8de3`, com o E8 mergeado)
- **Task vinculada**: OG1-T11 · `2723266000000148025` (zoho) — E10. O E10 tem 20 story points; este corte
  cobre a parte de backend.
- **Criada em**: 2026-10-08 · **Condução**: `/meta:drive` E8–E10 (aprovações automáticas; merge autorizado
  quando estiver ok)
- **Objetivo**: importar e exportar em CSV os cadastros mestres, as carteiras (cabeçalho e filtros) e os
  vínculos. A importação valida tudo numa simulação, gera um relatório por linha e só grava depois da
  confirmação. A exportação usa o mesmo layout e respeita a visibilidade do E8.

## Corte [auto]

O **E10** é o motor de backend: layouts, importação e exportação, com API, testes, smoke e docs. As
**telas** do E10 (enviar arquivo, ver o relatório, confirmar e baixar) entram no **E9**, junto com o wizard.

## Decisões [auto] — orquestrador, 2026-10-08

| Tema | Decisão | Por quê |
|---|---|---|
| Formato | UTF-8, com ou sem BOM na entrada e sempre com BOM na saída. Separador `;`, aspas `"` (RFC 4180), cabeçalho na 1ª linha, fim de linha CRLF na saída (LF ou CRLF na entrada). Listas dentro de um campo vêm separadas por `\|`. Booleano `S`/`N`. | É o default decidido em 2026-10-07: abre direto no Excel em pt-BR. |
| Cabeçalhos | Em pt-BR, `snake_case` e sem acento (`razao_social`). A ordem das colunas é livre. Coluna obrigatória ausente ou coluna desconhecida invalida o arquivo inteiro. | O arquivo é lido por gente. O que sobra ou falta é erro de layout, não de linha. |
| Layouts | `branches`, `product-subgroups`, `retail-networks`, `economic-groups`, `sellers`, `customers`, `portfolios` e `links`, cada um com dicionário de dados em `GET /v1/csv-layouts`. | Os cadastros do E2, as carteiras do E3 e os vínculos do E7. |
| Chave natural | Filial, subgrupo, rede, grupo e vendedor pelo **código**. Cliente pelo **CNPJ**. Carteira por **filial + nome**. Vínculo por **filial + carteira + CNPJ + subgrupo**. | São as chaves do ERP, decididas no E2. |
| Upsert | Se a chave não existe, a linha cria. Se existe, a linha atualiza, e sem diferença fica `unchanged` (nada é gravado e a versão não muda). A coluna `ativo` inativa ou reativa. | É a carga inicial e a manutenção em lote decididas na coleta. |
| Mesmas regras da API | Cada linha passa pelos **mesmos serviços de domínio** da API (validação, escopo de filial, permissão e auditoria). Não existe caminho paralelo de escrita. | Só assim o arquivo obedece a tudo o que o E2–E8 garantiram. |
| Simulação | A simulação roda as escritas de verdade numa transação que é **desfeita** no fim, em blocos de 200 linhas. O relatório diz, por linha: ação prevista (`create`, `update`, `unchanged`, `deactivate`, `reactivate`) ou erro, com a mensagem fixa do domínio, sem eco do valor. | O resultado previsto é o mesmo da gravação, sem duplicar regras. |
| Confirmação | Só confirma um job `validated` **sem nenhum erro**. A gravação usa blocos de 200 linhas em transações próprias. A linha cujo registro mudou desde a simulação (versão diferente) falha com `version_conflict` e não sobrescreve. | Não sobrescreve uma edição feita entre a simulação e a confirmação. Os blocos não travam a API por muito tempo. |
| Vínculos | O arquivo de vínculos é o **conjunto completo** de cada carteira que aparece nele. A importação troca as atribuições (E6) e **finaliza** a carteira (E7), que passa pelas regras de prévia, conflitos e grade completa. Cada carteira é uma unidade: se a finalização falha, todas as linhas dela falham com o motivo. | "Vínculos passam pelas regras de E4–E7". |
| Clientes fora do escopo | Um CNPJ que já existe, mas não está em nenhuma filial do ator, recebe só o **vínculo com as filiais do ator** pelo caminho do E2 (`linkCustomerToBranchByCnpj`). Os dados não são alterados, e a linha sai como `linked` com um aviso. | É o caminho que o E2 já aprovou. Não revela nem altera o cadastro de outra filial. |
| Assíncrono | `POST /v1/imports` responde `202` com o job, e a simulação roda em segundo plano, cedendo a vez entre os blocos. O mesmo vale para a confirmação. Um job por vez no processo. Na subida da API, o job que ficou no meio vira `interrupted`. | Pedido do E10. Com SQLite e instância única, uma fila serial no processo basta. |
| Exportação | `GET /v1/exports/:layout` gera o CSV na hora, em streaming, lendo pelas listagens paginadas dos serviços, o que aplica escopo e visibilidade do E8. O CSV é **síncrono**. | 50 mil clientes saem em menos de 1 s. Um job a mais não paga o custo. |
| Injeção de fórmula | Na saída, um valor que começa com `=`, `+`, `-`, `@`, tab ou CR recebe `'` na frente. Na entrada, esse `'` é retirado. | OWASP CSV injection. A volta do arquivo continua idempotente. |
| Permissão | Importar é só do admin (`requireAdmin` antes de criar o job; os serviços checam de novo por linha). Exportar vale para quem lê, com o recorte do perfil. Cada job só é visível a quem o criou (outro `sub` recebe 404). | Escrita é do admin desde o E2. O job carrega o arquivo de outra pessoa. |
| LGPD e auditoria | `import_jobs` guarda quem, quando, o layout, o hash SHA-256 do arquivo, as contagens e o estado. O **conteúdo** do arquivo é apagado ao terminar (gravado, cancelado, expirado ou com falha). O job `validated` expira em 24 h. O relatório guarda o nº da linha, a ação, o código e a mensagem fixa, nunca o conteúdo da linha. `userSub` do vendedor **não** entra no CSV. Sem CPF. | Minimização: o arquivo traz nomes de vendedores (pessoa física). |
| Limites | Até 16 MB e 100 mil linhas de dados por arquivo. | Folga para os 50 mil clientes da meta. |

### Revisão adversarial (REPROVADO, depois corrigido) — decisões [auto] revistas, 2026-10-08

| Tema | Antes | Agora | Achado |
|---|---|---|---|
| Simulação | Transação desfeita por bloco, então cada bloco não via o anterior | **Cópia do banco em memória** (`serialize`), com blocos cumulativos e descartada no fim | 1 |
| Escopo na confirmação | Valia o token da confirmação | A confirmação exige **os mesmos papéis e filiais** da simulação, e a linha com ação ou ativação diferente do simulado falha (`changed_since_validation`) | 2 |
| Arquivo | Coluna `content` no banco, apagada ao terminar | **Só na memória do processo**, nunca no banco nem no WAL. Teto de 128 MB abertos. Varredura de vencimento a cada 10 min e a cada envio. Reiniciar a API interrompe os jobs abertos | 3 |
| Bloqueio da API | Parse e pré-validação de uma vez | Leitor incremental, fatias com cessão de vez, campo gigante recusado durante a leitura, linha como classe. Teto do teste no p99 do event loop. Carteira grande nos vínculos documentada | 4 |
| Separadores | Sem regra | Código sem `\|` nem `:` e bairro de região sem `\|` (domínio E2/E3). A exportação falha em vez de gerar lista ambígua | 5 |
| `linked` + `ativo=N` | O `N` era ignorado | Inativa o vínculo recém-feito | 6 |
| Envio | O 403 vinha depois de ler o corpo | Admin conferido no `onRequest`. O parser de 16 MB só na rota de envio | 7 |
| Oráculo de existência | Mensagens diferentes | Filial do token antes de buscar a carteira. CNPJ inexistente igual a não membro (mesma mensagem do E6) | 8 |
| Relatório da gravação | Gravado fora da transação dos dados | Na mesma transação | 9 |
| Fórmula com `'` | Perdia o apóstrofo | A saída acrescenta sempre um `'`, e a entrada tira um | 10 |

## Riscos

1. **Gravação em blocos não é atômica no arquivo inteiro.** Uma falha no meio deixa os blocos anteriores
   gravados. O relatório mostra linha por linha o que entrou, e a reimportação do mesmo arquivo é
   idempotente (as linhas já gravadas saem como `unchanged`).
2. **Vínculos exigem a grade completa.** Uma carteira com uma célula sem vendedor falha inteira
   (`portfolio_incomplete`), como no E7.
3. O layout é o default proposto e **não foi validado com a GMill**. Os cabeçalhos ficam num lugar só, para
   trocar sem mexer em regra.

## Fora do escopo

Telas (E9). Integração automática com o ERP.

## 📋 Phase-Subtask Mapping
- **Phase 1**: "Codec CSV e layouts com dicionário" → Subtask ID: 2723266000000148025
- **Phase 2**: "Jobs de importação: simulação, confirmação e relatório" → Subtask ID: 2723266000000148025
- **Phase 3**: "Exportação, API, smoke, docs e revisão" → Subtask ID: 2723266000000148025
