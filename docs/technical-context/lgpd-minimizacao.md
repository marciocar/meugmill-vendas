---
updated: 2026-10-07
source: apps/api/src/plugins/auth.ts, apps/api/src/plugins/observability.ts, apps/api/src/routes/me.ts
---

# LGPD: minimização de dados na API

Escopo: `apps/api` (MeuGmill Vendas). Contexto regulatório da empresa vive no hub `gmill`.

## O que o serviço guarda hoje

- Do token JWT, apenas `sub`, perfis (`roles`) e filiais (`branchIds`), **em memória e por requisição**. O restante do payload é descartado em `extractClaims`.
- O banco (SQLite) ainda **não contém dado pessoal**.

## O que NUNCA guarda

- CPF.
- Dado de paciente/consumidor (sensível; fora do escopo do módulo).
- Token (Authorization) em log ou em qualquer storage.
- Corpo de requisição/resposta em log.

## Redação de logs

- Logs em JSON (pino). `redact` com `[REDACTED]` para `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, `*.token`, `*.password`, `*.cpf`, `*.email`.
- Serializers enxutos: método, URL **sem query string**, status e tempo de resposta. Nunca headers completos.
- Cada linha carrega `reqId`. O `x-request-id` do cliente só é aceito se tiver até 128 caracteres de `[A-Za-z0-9._-]`; senão é gerado um UUID.
- Erros 5xx respondem `{ "error": "internal_error" }`; stack e mensagem ficam só no log.
- O redact cobre um nível (`*.campo`). Objetos aninhados mais fundos exigem novos caminhos. Teste: `apps/api/test/observability.test.ts`.

## Minimização do `/v1/me`

Retorna somente `sub`, `roles` e `branchIds`, sem nome, e-mail ou outros claims.

## Pontos em aberto (E2+)

Dados de vendedores são de pessoa física. Pendências:

- Base legal do tratamento: [TO BE COMPLETED]. [INFERIDO] execução de contrato/legítimo interesse, a validar com o jurídico.
- Prazo de retenção (dados e logs): [TO BE COMPLETED].
- Direito de acesso e de eliminação (fluxo e responsável): [TO BE COMPLETED].
- Papel de controlador/operador e encarregado (DPO): [TO BE COMPLETED].
- Uso de `sub` como identificador nos logs: [INFERIDO] pseudonimizado pelo IdP; confirmar.
- Nomes dos claims (`roles`, `branch_ids`) são hipótese provisória: [INFERIDO].
