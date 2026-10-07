---
updated: 2026-10-07
source: teste do formulário de dúvidas pelo maestro (respostas sugeridas aceitas); não confirmado pelo cliente
---

# Carteira de clientes — hipóteses provisórias do microserviço

> **Status:** provisórias. Aceitas pelo maestro em 2026-10-07 num teste do formulário de dúvidas
> (https://claude.ai/artifact/WmoUnr6ENuUpc7goYw2dXX). **Ainda não foram confirmadas pelo cliente (GMill).**
> Cada item vale como default de implementação até a confirmação; ao confirmar, promova a fonte aqui.
> Base: [carteira-de-clientes.md](carteira-de-clientes.md).

## Login e perfis

| Tema | Hipótese | Marca |
|---|---|---|
| IdP | Provedor compatível com OIDC; issuer e URL de descoberta de homologação a receber | `[INFERIDO]` |
| Claims | `sub` = usuário; `branch_ids` = filiais; `roles` = perfis | `[INFERIDO]` |
| Perfis | Vendedor: clientes vinculados a ele no seu subgrupo. Responsável/gerente: clientes das carteiras que gerencia. Administrador: todas as carteiras da filial. Permissão específica: visão ampliada por filial | `[INFERIDO]` palpite |

## Uso pelo sistema principal

| Tema | Hipótese | Marca |
|---|---|---|
| Front do host | SPA; aceita script externo e o componente `<gmill-carteira>` | `[INFERIDO]` |
| Origens (CORS) | Dev: `http://localhost`; homologação e produção a definir | `[TO BE COMPLETED]` |
| Consumo | API para consultar visibilidade em tempo real + eventos quando um vínculo muda | `[INFERIDO]` |

## Dados e regras

| Tema | Hipótese | Marca |
|---|---|---|
| Carga inicial | Exportação do ERP em CSV; depois os cadastros são mantidos no microserviço, com reimportação por CSV | `[INFERIDO]` |
| Tipos de carteira | Geográfica (região) e Comercial (rede ou grupo econômico); o tipo só classifica | `[INFERIDO]` palpite |
| Distribuição automática | Equilíbrio por quantidade entre os vendedores de cada subgrupo, mantendo vínculos existentes | `[INFERIDO]` palpite |
| Chaves | Cliente: CNPJ (14 dígitos). Vendedor, filial, subgrupo, rede e grupo econômico: código interno do ERP | `[INFERIDO]` |
| Layout CSV | Sem padrão formal do cliente; proposto: UTF-8 com BOM, `;`, cabeçalho na 1ª linha, dicionário de dados por arquivo (padrão de mercado perguntado ao core em 2026-10-07) | `[INFERIDO]` |

## Infraestrutura

| Tema | Hipótese | Marca |
|---|---|---|
| Deploy | Docker Compose em servidor do cliente | `[INFERIDO]` |
| SQLite | Instância única aceitável; backup diário do arquivo, retenção de 30 dias | `[INFERIDO]` palpite |
| Volume | Sem resposta | `[TO BE COMPLETED]` |
| Prazo | Sem resposta útil ("nao" no teste) | `[TO BE COMPLETED]` |

## Contexto

| Tema | Hipótese | Marca |
|---|---|---|
| Código atual | Cliente dará acesso de leitura ao repositório ou à documentação da API | `[INFERIDO]` |
| Escopo futuro | Pedidos e títulos financeiros depois, com a mesma regra de visibilidade | `[INFERIDO]` |

> "palpite" = hipótese do time sem base no documento original; confirmar antes de implementar E5, E6 e E8.
