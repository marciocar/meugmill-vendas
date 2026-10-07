---
updated: 2026-10-07
source: decisões de trabalho da equipe (maestro + Claude), reinterpretadas após o E1 a partir do formulário de dúvidas; não confirmadas pelo cliente
---

# Carteira de clientes — decisões de trabalho do microserviço

> **Status:** decisões de trabalho da equipe. Por decisão do maestro (2026-10-07), as dúvidas do
> formulário (https://claude.ai/artifact/WmoUnr6ENuUpc7goYw2dXX) foram **respondidas pela própria
> equipe**, reinterpretadas com o que o E1 mostrou na prática. **Nenhuma foi confirmada pelo cliente
> (GMill).** Elas valem como default de implementação. Cada uma é configurável ou isolada no código,
> para que uma correção do cliente custe um ajuste e não uma reescrita. Quando o cliente confirmar ou
> corrigir, promova a fonte aqui.
>
> Legenda: `[INFERIDO]` = hipótese com alguma base (documento original ou padrão de mercado);
> `[INFERIDO] palpite` = decisão da equipe sem base no documento, que é a de maior risco;
> `[TO BE COMPLETED]` = depende de informação que só o cliente tem.
>
> Base: [carteira-de-clientes.md](carteira-de-clientes.md).

## 1. Login e perfis de acesso

| Dúvida | Decisão de trabalho | Onde está no código | Marca |
|---|---|---|---|
| Provedor de login | Qualquer IdP **OIDC** com discovery e JWKS por **https**. O serviço não guarda senha. Issuer e audience vêm por variável (`OIDC_ISSUER`, `OIDC_AUDIENCE`). | `apps/api/src/plugins/auth.ts` | `[INFERIDO]` |
| Tipo de token | A API aceita **access token**. Assim que o IdP for conhecido, exigir `typ: at+jwt` (RFC 9068) ou uma `aud` própria da API, diferente do `client_id` do front, para que um ID token não passe como access token. | `auth.ts` (pendente) | `[INFERIDO]` |
| Claims | `sub` = usuário, `roles` = perfis, `branch_ids` = filiais. Os nomes são trocáveis por `OIDC_CLAIM_ROLES` e `OIDC_CLAIM_BRANCHES`. Nada de nome, e-mail ou CPF no que o serviço lê. | `config.ts`, `auth.ts` | `[INFERIDO]` |
| Perfis | Quatro perfis, do mais restrito ao mais amplo, sempre limitados às filiais do token: **vendedor** vê os clientes vinculados a ele nos subgrupos dele; **gestor** (responsável da carteira) vê todos os clientes das carteiras que gerencia; **admin** vê todas as carteiras das suas filiais; **supervisao** vê, sem editar, todas as carteiras das suas filiais. Isso cobre a "permissão específica" do documento. | E8 | `[INFERIDO] palpite` |

## 2. Como o sistema principal usa o serviço

| Dúvida | Decisão de trabalho | Marca |
|---|---|---|
| Front do host | O host embarca `<gmill-carteira>` com um `<script>`. Ele passa o token **por propriedade**, nunca por atributo, e renova quando recebe o evento `token-expired`. Isso funciona em qualquer framework. | `[INFERIDO]` |
| Origens (CORS) | Cada ambiente declara as origens **exatas** em `CORS_ORIGINS`. Dev usa `http://localhost:8081`; homologação e produção entram quando existirem. | `[TO BE COMPLETED]` |
| Consumo | **API síncrona primeiro.** No E8, `GET /v1/visibility` responde quais clientes o usuário pode ver. **Eventos ficam para depois**: o E7 grava cada mudança de vínculo numa tabela de saída (*outbox*), que um publicador pode ler quando houver um barramento. Assim não amarramos o MVP a uma infraestrutura que não sabemos se existe. | `[INFERIDO]` |

## 3. Dados e regras de negócio

| Dúvida | Decisão de trabalho | Marca |
|---|---|---|
| Carga inicial e manutenção | O serviço é dono dos cadastros mestres (decisão de coleta). A carga inicial e as atualizações em lote entram por **importação de arquivo**, que é o E10. Uma sincronização automática com o ERP só entra se o cliente pedir. | `[INFERIDO]` |
| Tipos de carteira | **Geográfica** (filtro de região) e **Comercial** (rede ou grupo econômico). O tipo **só classifica**: não muda prioridade nem distribuição. O tipo é um cadastro simples, não um enum no código, para o cliente poder criar outros. | `[INFERIDO] palpite` |
| Distribuição automática | **Equilíbrio por quantidade** dentro de cada subgrupo: preserva os vínculos existentes e distribui só os clientes sem vendedor, sempre para quem tem menos. O empate é decidido de forma determinística (código do vendedor), para que a mesma entrada gere a mesma saída. A regra fica isolada como **estratégia**, para trocar por rodízio ou faturamento sem tocar no resto. | `[INFERIDO] palpite` |
| Chaves | Cliente: **CNPJ** (14 dígitos, só números, com dígito verificador validado). Vendedor, filial, subgrupo, rede e grupo econômico: **código interno do ERP**. Sem CPF em nenhum lugar. | `[INFERIDO]` |
| Layout de arquivo | Para o E10 vale o default: UTF-8 com BOM, separador `;`, cabeçalho na primeira linha e um dicionário de dados por arquivo. O E10 **não espera** a resposta do core (decisão de 2026-10-07). | `[INFERIDO]` |

## 4. Infraestrutura e operação

| Dúvida | Decisão de trabalho | Marca |
|---|---|---|
| Onde roda | **Docker Compose num servidor do cliente**, como no E1. A imagem já é portável para Kubernetes se precisarem depois. | `[INFERIDO]` |
| SQLite em produção | **Instância única**, com volume persistente e **backup diário** do arquivo (com a API pausada ou via `VACUUM INTO`), retido por 30 dias. Se o cliente exigir alta disponibilidade, a troca para PostgreSQL vira um épico próprio (o Drizzle mantém isso barato). | `[INFERIDO] palpite` |
| Volume | Dimensionar para **até 50 mil clientes, 500 vendedores, 50 filiais e 1 mil carteiras**, folgado para um distribuidor regional. Isso serve de **meta de teste de carga**, não de dado do cliente. | `[TO BE COMPLETED]` (meta da equipe) |
| Prazo | Não há prazo informado. A equipe segue **um épico por vez**, na ordem E2 → E8 → E10 → E9. | `[TO BE COMPLETED]` |

## 5. Contexto

| Dúvida | Decisão de trabalho | Marca |
|---|---|---|
| Código atual do MeuGmill | **Não dependemos dele.** Implementamos a partir do documento de negócio e destas decisões. Se o acesso vier, ele serve para conferir regras, não para copiar código. | `[INFERIDO]` |
| Escopo futuro | Pedidos e títulos financeiros ficam **fora deste serviço**. O que este serviço oferece a eles é a consulta de visibilidade do E8, que o sistema principal aplica aos dados que já tem. | `[INFERIDO]` |
| Algo não perguntado | **LGPD:** os dados de vendedores são de pessoa física. A base legal (execução de contrato ou legítimo interesse), a retenção dos vínculos inativos e o atendimento a pedidos de acesso ou eliminação precisam de decisão antes de ir para produção. Ver `docs/technical-context/lgpd-minimizacao.md`. | `[TO BE COMPLETED]` |

## O que mais pesa se o cliente discordar

1. **Perfis** (E8): mudam quem vê o quê. É o maior risco.
2. **Distribuição automática** (E6): isolada como estratégia, então trocar sai barato.
3. **SQLite com instância única** (operação): se for vetado, vira o épico da troca para PostgreSQL.
4. **Tipos de carteira** (E3): cadastro simples, então trocar sai barato.
