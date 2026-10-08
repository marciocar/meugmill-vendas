# Contexto — demo-gmill

- **Branch**: feature/demo-gmill (base: main `5acbde3`, com E1–E10 mergeados)
- **Task vinculada**: OG1-T12 · `2723266000000159013` (zoho) — Demo do Onion para a GMill (criada nesta sessão
  a pedido do maestro: "se não tiver task para isso, coloque lá e gerencie")
- **Criada em**: 2026-10-08 · **Condução**: `/meta:drive` ("escolha você mesmo as melhores opções para uma super
  demonstração do Onion")
- **Objetivo**: preparar a apresentação do desenvolvimento com o Onion para a GMill: demo ao vivo com dados
  limpos, capturas reais e um deck com o método e os números do projeto.

## Decisões [auto] — orquestrador, 2026-10-08

| Tema | Decisão | Por quê |
|---|---|---|
| Dados da demo | Filial `DEMO-ES` isolada, com 48 farmácias, 7 vendedores, 4 subgrupos, 2 redes e 1 grupo, todos fictícios e só de empresa | O ambiente de desenvolvimento tinha lixo do smoke ("Carteira de fumaça", 26 carteiras disputando os mesmos clientes). A filial isolada não depende de limpar nada |
| Como carregar | Pela **importação CSV do próprio produto** (simular, conferir, confirmar), não por SQL | A carga da demo é ela mesma uma demonstração do E10, e é o caminho da carga real da GMill |
| Enredo | Serra Norte finalizada; Rede FarmaVida vencendo regiões; empate Grande Vitória × Vitória Centro para resolver ao vivo; Cariacica criada no palco | Mostra as regras difíceis (disputa, visibilidade) em 10 minutos |
| Logins | 4 clientes `demo-*` no IdP de teste, um por perfil, só na filial DEMO-ES | Trocar de perfil na demo sem colar token |
| Repetibilidade | Seed idempotente; `--expect-unchanged` no CI prova isso a cada PR | A demo não pode envelhecer em silêncio |
| Capturas | Navegador automático (Chromium headless) percorrendo o próprio roteiro | O ensaio geral e as imagens do deck saem do mesmo passeio |
| Deck | Artifact de slides com o design system Onion Evolve (o único disponível) | Carta branca do maestro; é a identidade do Onion |
| Números do deck | Só medidos: git log, gh pr list, vitest e os resíduos de revisão | Nada de estimativa de marketing |

## Achado de uso real nesta frente

O dicionário de dados do CSV mostrava crases literais (`` `;` ``), vindas do texto em markdown da API. A
captura para o deck mostrou; os trechos entre crases passaram a sair como código (`withCode`), com teste.
