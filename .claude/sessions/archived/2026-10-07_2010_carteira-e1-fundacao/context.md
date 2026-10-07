# Contexto — carteira-e1-fundacao

- **Branch**: feature/carteira-e1-fundacao
- **Base**: main (adoção do Onion mergeada localmente em `6c95c86`)
- **Task vinculada**: OG1-T2 · `2723266000000146018` (zoho) — E1, subtask de OG1-T1 `2723266000000144089`
- **Criada em**: 2026-10-07
- **Objetivo**: erguer a fundação do microserviço Carteira de Clientes (monorepo, API, front, persistência,
  auth, observabilidade, CI e container) para que os épicos E2–E10 construam funcionalidade sobre ela.

## Por que

O sistema principal do Grupo GMill vai absorver a carteira de clientes como um microserviço independente,
que é a SSOT das carteiras e dos vínculos e entrega API e front embarcável
(`docs/business-context/02-product/features/carteira-de-clientes.md`). O E1 não entrega regra de negócio:
entrega o chão em que E2–E10 andam. Erro de fundação se paga em todos os épicos seguintes.

## Resultado esperado

Um repositório que, num clone limpo, sobe com um comando (`docker compose up`) e entrega:

- API Fastify com `GET /health` (liveness) e `GET /ready` (readiness, checa o banco);
- uma rota protegida de exemplo (`GET /v1/me`) que só responde com JWT válido (JWKS) e devolve as claims
  mínimas do usuário, sem dado pessoal além do necessário;
- front como **Web Component** (`<gmill-carteira>`, React + Vite) com uma página de demonstração que o
  embarca como o sistema principal faria, sem regra de negócio;
- SQLite com migrations versionadas;
- logs estruturados em JSON com correlation id e redação de campos sensíveis;
- CI rodando lint, typecheck, testes e build da imagem.

## Decisões tomadas (maestro, 2026-10-07)

| Tema | Decisão |
|---|---|
| Código | Neste repo (`meugmill-vendas`) |
| API | Node.js + TypeScript com **Fastify** |
| Front | **React + Vite empacotado como Web Component** (base do E9) — trocado de Next.js no refinamento de 2026-10-07 |
| Banco | **SQLite** |
| Auth | JWT emitido pelo IdP do sistema principal, validado via **JWKS** (OIDC); IdP local de dev no Compose |
| Deploy | **Docker + Compose** |

## Restrições

- **LGPD:** dados de vendedores são de pessoa física. Minimização desde o E1: nada de CPF, logs com
  redação, nenhum dado de paciente/consumidor (fora de escopo e proibido).
- **Spec as Code:** marcações `[INFERIDO]` / `[TO BE COMPLETED]` dos docs de negócio não se apagam.
- Commits: prefixo Conventional em inglês, assunto e corpo em pt-BR; gate em `.githooks/pre-commit`.
- Sem regra de negócio de carteira no E1: entidades e endpoints de domínio são E2+.

## Riscos e pontos de atenção (registrados, não bloqueiam)

1. **SQLite num microserviço SSOT.** Um único escritor por arquivo e nenhuma réplica nativa: o serviço
   roda com **uma instância** (sem escala horizontal) e o arquivo precisa de volume persistente e backup.
   Mitigação no E1: WAL ligado, acesso só via ORM com dialeto trocável (Drizzle), migrations
   portáveis — se o volume ou a operação do cliente pedirem, a troca para PostgreSQL é uma fase, não uma
   reescrita. Vale confirmar com o contato da GMill se uma instância única é aceitável em produção.
2. **Contrato de embarque do Web Component.** `[INFERIDO]` O host aceita carregar um script externo e
   colocar `<gmill-carteira api-base="…" token="…">` na tela. O token chega por atributo/propriedade e o
   componente pede renovação pelo evento DOM `token-expired`, sem guardar credencial. A API libera a
   origem do host por configuração de CORS. Confirmar com o contato da GMill. (Resolvido em 2026-10-07:
   a troca de Next.js para Web Component foi decidida porque um custom element embarca em qualquer
   framework do host, e o Next é uma aplicação inteira.)
3. **IdP do sistema principal desconhecido.** Issuer, audience e claims de perfil (vendedor, admin,
   permissão específica) dependem do contato da GMill. O E1 deixa issuer/audience/JWKS por variável
   de ambiente e usa um IdP local de dev.

## Perguntas em aberto para o contato da GMill

- IdP/issuer, audience e quais claims identificam usuário, filial e perfil.
- Instância única com SQLite é aceitável em produção? Política de backup.
- Onde o front vai ser embarcado (stack do sistema principal).
- Padrão de layout CSV (pergunta enviada ao core em 2026-10-07; afeta E10, não E1).

## Como testar

- Unitários e de integração na API (Vitest + `fastify.inject`), incluindo JWT válido, expirado, de outro
  issuer e sem token, com JWKS local.
- Teste de fumaça do Compose: `docker compose up` → `/health` 200, `/ready` 200, `/v1/me` 401 sem token.
- CI obrigatório verde antes do PR.

## 📋 Phase-Subtask Mapping
- **Phase 1**: "Monorepo e esqueleto (API Fastify + Web Component Vite)" → Subtask ID: 2723266000000146018
- **Phase 2**: "Persistência SQLite e migrations" → Subtask ID: 2723266000000146018
- **Phase 3**: "Autenticação JWT/JWKS" → Subtask ID: 2723266000000146018
- **Phase 4**: "Observabilidade e base LGPD" → Subtask ID: 2723266000000146018
- **Phase 5**: "Container, Compose e CI" → Subtask ID: 2723266000000146018

> O E1 não tem subtasks no Zoho; todas as fases apontam para a própria task OG1-T2. Se as fases virarem
> subtasks (o especialista sugeriu quebrar o E1), este mapa é atualizado.
