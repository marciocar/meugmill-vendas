# Roteiro da demonstração para a GMill

Demonstração de 10 minutos do MeuGmill Vendas (carteira de clientes) rodando no Docker, com dados fictícios
da filial `DEMO-ES`. O deck que acompanha a demo conta como o Onion conduziu o projeto (método, números e
telas).

## Preparar (antes da reunião)

```bash
docker compose up -d                       # API, IdP de teste e a tela (portas 39000, 39080 e 39081)
docker compose up -d --force-recreate idp  # o IdP só lê docker/idp-config.json ao subir
node scripts/demo/seed.mjs                 # carrega a filial DEMO-ES pela importação CSV do próprio produto
```

Abra `http://localhost:39081/demo/index.html`, escolha um perfil do grupo **Demonstração** e clique em
**Obter token de teste**.

- **Rodar o seed de novo** restaura os cadastros e os **filtros e vendedores** das quatro carteiras, sem
  duplicar nada. Ele **não** desfaz o resto do que se fizer no ensaio: uma carteira finalizada continua
  finalizada (com os vínculos), atribuições e ajustes manuais continuam, e uma carteira criada ao vivo (a
  Cariacica) continua existindo. Depois de um ensaio que siga o roteiro, faça o **ensaio do zero**.
- **Ensaio do zero:** `docker compose down -v`, `docker compose up -d` e `node scripts/demo/seed.mjs`. O
  `down -v` apaga o volume local de desenvolvimento inteiro, inclusive os dados do smoke.

A documentação fica em `http://localhost:39081/docs/`: o manual de uso e a referência da API, onde dá para
testar as chamadas com um token de demonstração.

**Domínio para a GMill** (`https://gmill.onionevolve.com`, publicado pelo Caddy da VPS com senha na frente): suba
com `docker compose -f compose.yaml -f compose.gmill.yaml up -d`. Esse modo troca o emissor do token para o do
domínio, e então o acesso por túnel SSH em `localhost` deixa de autenticar até voltar ao `docker compose up -d`
simples.

| Perfil na demo | Login (`sub`) | O que vê                                                         |
| -------------- | ------------- | ---------------------------------------------------------------- |
| admin          | `demo-admin`  | Tudo da filial DEMO-ES; cria, edita, importa                     |
| gestor         | `demo-gestor` | As carteiras em que é responsável (Serra Norte e Grande Vitória) |
| vendedor       | `demo-vend`   | Só os clientes ligados a ele (Ana Martins, V101)                 |
| supervisão     | `demo-sup`    | Tudo, sem editar                                                 |

## O enredo

| Carteira       | Situação                 | Por quê está aí                                                 |
| -------------- | ------------------------ | --------------------------------------------------------------- |
| Serra Norte    | finalizada (36 vínculos) | Mostra uma carteira pronta; perde 2 lojas para a Rede FarmaVida |
| Rede FarmaVida | rascunho                 | Rede vence região: aparece como concorrente nas outras          |
| Grande Vitória | rascunho                 | Empata com a Vitória Centro em 13 farmácias de Vitória          |
| Vitória Centro | rascunho                 | O outro lado do empate; é a que o apresentador refina ao vivo   |
| Cariacica      | não existe               | Criada ao vivo pelo wizard                                      |

## Roteiro (10 minutos)

1. **0 a 2 · admin · a lista.** Serra Norte finalizada; as outras em rascunho. Abrir a Rede FarmaVida e
   mostrar no Resumo que ela não perde nada: rede vence região.
2. **2 a 4 · admin · o empate.** Abrir a Grande Vitória, etapa 5 Clientes, filtrar **Disputa = Empate**: 13
   farmácias de Vitória, "com Vitória Centro". Tentar **Finalizar**: o sistema recusa e diz por quê.
3. **4 a 6 · admin · resolver.** Abrir a Vitória Centro, etapa 2 Filtros: remover `ES / Vitória`, adicionar
   **Bairro** ES / Vitória / `Centro`, salvar. No Resumo: 0 bloqueados. A regra (bairro vence município)
   resolveu, sem editar cliente por cliente.
4. **6 a 8 · admin · carteira nova.** Nova carteira **Cariacica**, tipo Geográfica. Filtros: Município
   Cariacica. Vendedores: Genéricos com V105 e V106; MIP com V106. Resumo, Clientes, **Distribuir
   automaticamente**, **Finalizar carteira**: 12 vínculos.
5. **8 a 9 · vendedor · visibilidade.** Trocar o perfil para vendedor, aba **Meus clientes**: só as 6
   farmácias da Ana. Contar que o sistema principal usa a mesma regra pela API para pedidos e títulos.
6. **9 a 10 · admin · planilhas.** Aba **Importar e exportar**, layout Clientes: o dicionário de dados.
   Exportar o CSV e reenviar: a simulação mostra tudo "sem mudança" (cancelar em seguida).

## Se algo der errado

- **Tela pede "Configure a API e o token"**: clique em **Obter token de teste** de novo (o token de teste
  vale 1 hora).
- **"Sessão expirada"**: mesmo remédio; a tela continua onde estava.
- **Nome de carteira já existe (Cariacica)**: foi criada num ensaio anterior. Use outro nome ou faça o
  ensaio do zero.
- **API fora do ar**: `docker compose ps`; `docker compose up -d` sobe de novo.
- **Perfil "admin (demo-admin)" entra como vendedor, ou o seed diz que o IdP está com a config antiga**: o IdP
  subiu antes dos logins de demo existirem. `docker compose up -d --force-recreate idp`.

## Os dados

Gerados por `scripts/demo/generate-data.py` em `scripts/demo/data/` e carregados por
`scripts/demo/seed.mjs`. Todos são **fictícios e só de empresa**: CNPJs calculados (módulo 11) a partir de
uma raiz fixa, nomes de farmácia e de vendedor inventados, nenhum CPF, e-mail ou dado de paciente. Qualquer
coincidência com empresa ou pessoa real é acaso.

Riscos conhecidos: os códigos de catálogo da demo (`GEN`, `MIP`, `DERM`, `FRIO`, `GEO`, `REDE`, `RD-*`, `GE-*`) são
globais; num banco com dados próprios usando os mesmos códigos, o seed renomearia esses cadastros. Use a demo
num banco de desenvolvimento. A raiz dos CNPJs (70.000.001 a 70.000.048) pode coincidir com a que o smoke gera
a partir do relógio numa janela de 48 segundos a cada cerca de 3 anos (a próxima em 2029).

O CI roda o seed depois do smoke e de novo com `--expect-unchanged`, que não escreve nada e falha se algo
precisaria mudar.
