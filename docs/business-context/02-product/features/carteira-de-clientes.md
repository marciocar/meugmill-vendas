---
updated: 2026-10-07
source: material do maestro (gmill/trash/carteira-de-clientes-meugmill-vendas.md), trazido na adoção sem edição
---

> **Última Atualização:** 2026-10-07 · **Proveniência:** texto do maestro, que declara ter sido "conferido na
> interface e na API do projeto". Não foi re-verificado na adoção — este repo ainda não tem o código. O
> grafo de domínio `docs/onion/graph/carteira-de-clientes.kg.yaml` deriva deste arquivo.

# Como funciona a carteira de clientes no MeuGmill Vendas

## Para que serve

A carteira de clientes organiza **quais clientes cada vendedor atende**. Ela também delimita quais clientes e informações comerciais aparecem para cada vendedor no MeuGmill Vendas.

Uma carteira pertence a uma **filial**, tem um responsável e pode reunir um ou mais vendedores. Ela define um conjunto de clientes usando critérios comerciais ou geográficos. Depois, os clientes são distribuídos entre os vendedores, manualmente ou de forma automática.

## Como uma carteira é montada

O cadastro segue estas etapas:

1. **Informações:** nome, descrição, filial, responsável e tipo da carteira.
2. **Filtros:** seleção de um ou mais critérios para localizar clientes:
   - **Região:** estado, cidade e, quando necessário, bairro;
   - **Rede:** clientes de uma rede varejista ou atacadista;
   - **Grupo econômico:** empresas relacionadas à mesma controladora.
3. **Vendedores:** escolha de quem fará os atendimentos e dos subgrupos de produtos que cada pessoa atende.
4. **Resumo:** revisão dos dados e dos critérios escolhidos.
5. **Clientes:** análise da lista sugerida e atribuição de cada cliente a um vendedor.

Os filtros ajudam a sugerir clientes. A prévia pode ser revisada, e clientes também podem ser incluídos manualmente.

## Como o sistema decide quais clientes entram

O sistema compara os critérios da carteira com os dados cadastrados dos clientes. Quando há mais de um tipo de filtro, o cliente precisa atender aos critérios selecionados que estiverem preenchidos.

Se duas carteiras da mesma filial alcançarem o mesmo cliente, o sistema considera a correspondência mais específica. A ordem de prioridade é:

1. Grupo econômico;
2. Rede;
3. Região por bairro;
4. Região por cidade;
5. Região por estado.

Assim, uma carteira definida para um bairro pode ter prioridade sobre outra definida para toda a cidade. Se duas carteiras tiverem a mesma prioridade para um cliente, esse cliente fica bloqueado nas duas prévias para que a equipe revise o conflito.

## Como os clientes são distribuídos

O responsável pode escolher um vendedor para cada cliente ou usar a distribuição automática. A distribuição automática divide os clientes entre os vendedores disponíveis em cada subgrupo.

Um mesmo cliente pode ser atendido por vendedores diferentes **em subgrupos diferentes**. Dentro do mesmo subgrupo, porém, só pode haver um vendedor responsável pelo cliente. Por exemplo, uma pessoa pode atender o cliente em Medicamentos e outra em Consumo.

Ao finalizar, o MeuGmill grava os vínculos entre carteira, cliente, vendedor e subgrupo. Ao editar uma carteira, o sistema compara as atribuições atuais com a lista revisada: vínculos removidos da lista deixam de ficar ativos, e novos vínculos são criados.

## O que muda para o vendedor

A carteira serve também como regra de visibilidade. Em geral, o vendedor consulta os clientes associados a ele; administradores e usuários com permissão específica podem consultar uma carteira mais ampla. A mesma regra de acesso também é aplicada a dados relacionados, como pedidos e títulos financeiros.

Isso ajuda a pessoa a trabalhar com os clientes pelos quais é responsável, e ajuda a empresa a organizar a cobertura comercial por região, rede, grupo econômico e linha de produto.

## Exemplo simples

Uma filial quer organizar o atendimento de clientes da região Norte:

- Cria a carteira **“Norte — Farmácias”**;
- Seleciona a filial e a gerente responsável;
- Usa o estado e a rede como critérios;
- Escolhe os vendedores e os subgrupos que cada um atende;
- Revê os clientes encontrados;
- Distribui os clientes automaticamente e ajusta alguns casos manualmente;
- Finaliza a carteira.

Depois disso, cada vendedor passa a encontrar os clientes que foram atribuídos a ele, respeitando a divisão por subgrupo e as permissões do seu usuário.

## Um bom exercício para uma aula de IA

Peça à IA para explicar ou resumir as regras usando apenas este documento. Por exemplo:

> Explique como funciona a carteira de clientes do MeuGmill Vendas para uma pessoa nova na equipe. Use o exemplo de uma filial com dois vendedores e dois subgrupos. Mostre como os clientes são encontrados, distribuídos e como a regra evita que dois vendedores fiquem responsáveis pelo mesmo cliente no mesmo subgrupo. Não invente regras além das descritas neste material.

Esse exercício mostra como a IA pode transformar uma regra de negócio em uma explicação adequada para cada público. No MeuGmill, a seleção e a distribuição dos clientes são feitas pelas regras do sistema; a IA pode ajudar a explicar essas regras, mas não substitui o cadastro nem decide as atribuições.

---

**Origem:** funcionalidade de carteira de clientes do módulo MeuGmill Vendas, conferida na interface e na API do projeto. Este material descreve o fluxo atual em termos de negócio; detalhes de acesso podem variar conforme o perfil e as permissões do usuário.
