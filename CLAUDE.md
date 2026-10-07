# 🧅 meugmill-vendas — Claude Code Rules

## 🎯 Identidade

Este é o repositório do **MeuGmill Vendas**, o módulo de vendas do MeuGmill, do **Grupo GMill**
(distribuição farmacêutica atacadista, Serra/ES). Foi adotado pelo Sistema Onion em modo `greenfield`
a partir do hub `gmill`, e é carimbado `role: adopted`.

- **Cadeia:** core (`onion-evolve`) → hub (`gmill`) → **este repo (`adopted`)**.
- **Papel `adopted`:** consome o framework. Não adota outros repos e não é autor do framework. As
  atualizações chegam pelo `/meta:adopt --update meugmill-vendas`, rodado **a partir do hub `gmill`**.
- **Proveniência** em `.claude/.onion-version` (`source_commit` = commit do hub que o instalou).
- Alguns comandos do pacote são exclusivos do core (`/meta:forge`, `/meta:evolve`, `/meta:dissect`,
  `/meta:co-announce`, `/meta:co-deliver`, `/meta:federation-publish`, `/meta:create-*`). Chegaram por um
  defeito do corte por papel que o core já reconheceu; **não use aqui**, eles saem no próximo `--update`.

## 📊 O que já existe aqui

- `docs/business-context/` — SSOT de negócio **do módulo**. O contexto da empresa (cliente, mercado,
  operações, regulação) vive no hub `gmill`; não duplique, referencie.
- 1ª funcionalidade documentada: **carteira de clientes**
  (`docs/business-context/02-product/features/carteira-de-clientes.md`), com o grafo de domínio
  `docs/onion/graph/carteira-de-clientes.kg.yaml`. O texto veio do maestro e **ainda não foi conferido
  contra o código**, que não está neste repo.
- Marcações `[INFERIDO]` e `[TO BE COMPLETED]` são parte do contrato: não as apague ao editar; promova-as
  com fonte.

## ⚖️ Escopo regulatório (herdado do hub)

O Grupo GMill opera sob **AFE/AE ANVISA**, **SNCM**, **Portaria 344** e **cadeia fria** (ver o hub). Para
este módulo, o ponto mais direto é a **LGPD**: a carteira lida com dados de vendedores (pessoas físicas)
e de clientes comerciais. **Dado de paciente/consumidor é sensível e não deve ser tratado**; se aparecer
numa conversa, não registrar nem repetir. `docs/compliance-context/` está como template vazio; para
popular: `/docs:build-compliance-docs`.

## 🔌 Task Manager — Detecção e Roteamento

Provider-agnóstico via SDAAL (`.claude/utils/task-manager/`). **Antes de operar com tasks**, carregue o
ambiente (`set -a; source .env; set +a`) e leia `TASK_MANAGER_PROVIDER`
(`jira` | `clickup` | `asana` | `linear` | `zoho` | `none`) + `TASK_MANAGER_TRANSPORT` (`api` default |
`mcp`). Variável ausente → avisar em pt-BR e sugerir `/meta:setup-integration`; nunca inventar valores.

## 🐙 Forge — Operações de Host Remoto

Abstraído via SDAAL (`.claude/utils/forge/`). `/git/*` e `/engineer:pr` **nunca** chamam `gh`/API direto —
passam pelo adapter. Git local (branch/merge/tag/push) é `git` direto.

## 📝 Diretrizes de Linguagem

Autoridade canônica: skill **`language-standards`**.
- **Chat, comentários, docs, READMEs, mensagens ao usuário**: Português brasileiro (pt-BR)
- **Código, variáveis, funções, nomes de arquivo/branch, logs**: Inglês
- **Commits**: prefixo Conventional em inglês + assunto e corpo em pt-BR

## 🛠️ Padrões Técnicos

- Comandos: `.claude/commands/` por categoria · Agentes: `.claude/agents/<categoria>/`
- Sessões: `.claude/sessions/<feature-slug>/` (kebab-case)
- **Spec as Code** — contextos L1+ deste repo (o L0 do framework vive em `docs/meta-specs/`):
  `docs/business-context/` · `docs/technical-context/` · `docs/compliance-context/` · `docs/knowledge-base/`
- **Estado:** `docs/onion/graph/*.kg.yaml` é a SSOT de "onde estamos". Antes de reconstruir de git ou
  prosa, rode `bash .claude/validation/kg-radar.sh <grafo>`.
- **Branches:** produto na `main`. A instalação entrou por `onion/adopt`; `onion/vendor` é a fonte do
  merge 3-way do `--update` (não commite nela).

## ⚠️ Setup após clonar (o gate NÃO viaja no clone)

O gate determinístico é um hook git nativo em `.githooks/pre-commit`, ativado por `core.hooksPath` —
**config local, não objeto git**. Um clone fresco traz o hook **inerte**. Quem clonar roda uma vez:

```bash
git config core.hooksPath .githooks
```

Conferir por **execução**, não por existência de arquivo: `bash .githooks/pre-commit`.

## 🚀 Entrada

- `/warm-up` — carrega o contexto do projeto
- `/onion` — ponto de entrada inteligente
- `/product:warm-up` — contexto de negócio
- `/meta:co-evolve` — co-evolução (sinais ao hub/core)
