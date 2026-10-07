---
title: "Qual é o padrão de mercado para PEDIR e ESPECIFICAR layouts de importação/exportação CSV — e o Onion tem (ou deveria ter) um artefato para isso?"
date: 2026-10-07
type: signal
from: meugmill-vendas (adopted, via hub gmill, pin b4d38766cb65)
to: core (onion-evolve)
flow: upstream
severity: medium
decision_owner: core (maestro sela)
---

# Como pedir layouts CSV num padrão de mercado

## Contexto (2026-10-07)

No refinamento do microserviço **Carteira de Clientes** (MeuGmill Vendas, Grupo GMill), entrou um épico
**E10 — Importação e exportação CSV**. Ele cobre três famílias de layout:

1. **Dados mestres:** filiais, clientes, vendedores, subgrupos de produto, redes, grupos econômicos e regiões
   (UF/cidade/bairro);
2. **Carteiras:** cabeçalho (nome, filial, responsável, tipo) e filtros;
3. **Vínculos:** carteira × cliente × vendedor × subgrupo.

Decisões já tomadas: a importação faz **upsert pela chave natural**, com **validação em simulação antes de
gravar** e relatório por linha. Os vínculos passam pelas **mesmas regras de domínio** (prioridade de conflito
e unicidade por subgrupo). A exportação usa o **mesmo layout** da importação e respeita a visibilidade do
usuário.

Defaults ainda `[INFERIDO]`: UTF-8 com BOM, `;`, decimal `,`, CNPJ como chave do cliente, código interno
para vendedor/filial, **sem CPF** (minimização LGPD), job assíncrono e auditoria da importação.

## A pergunta

O maestro precisa **pedir os layouts ao cliente** (o time do sistema principal da GMill) e quer fazer isso
num **padrão reconhecido pelo mercado**, não num formato inventado.

1. **Qual é o padrão?** Por exemplo, RFC 4180 para o CSV em si, *CSV on the Web* (W3C, metadata JSON /
   Table Schema), Frictionless *Table Schema* / *Data Package*, ou um "dicionário de dados / layout de
   arquivo" no estilo dos leiautes de EDI e SPED/NF-e usados no Brasil. O que se usa para **especificar**
   (coluna, tipo, obrigatoriedade, tamanho, domínio, chave, exemplo) e para **acordar** o layout entre dois
   times?
2. **Como pedir?** Existe um modelo de solicitação (template de "especificação de layout de interface")
   que o Onion recomende enviar ao cliente?
3. **Onde mora no Onion?** Isso deveria virar um KB/template do framework (ex.: em
   `common/templates/` ou numa KB de engenharia de integração), um artefato em
   `docs/technical-context/`, ou uma nova seção da spec (`/product:spec`)? Hoje o adotante não acha nada
   no pacote para isso.

## O que ajudaria o adotante

- Uma recomendação curta de padrão (com fonte e tier);
- Um template de layout/dicionário de dados que dê para enviar ao cliente;
- A decisão sobre onde esse artefato vive no framework, se for o caso.

## Nota

Nenhum dado de cliente, vendedor ou paciente vai neste sinal. Só a estrutura da pergunta.
