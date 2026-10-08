"""Gera os CSVs da demo (filial DEMO-ES). Todos os dados são FICTÍCIOS e só de empresa (sem CPF nem paciente).

Os CNPJs são calculados (módulo 11) a partir de uma raiz fixa: são válidos no formato, e qualquer
coincidência com empresa real é acaso. Rodar de novo gera exatamente os mesmos arquivos.

Uso: python3 scripts/demo/generate-data.py
"""
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
BRANCH = 'DEMO-ES'

SERRA, VITORIA, VILA_VELHA, CARIACICA = 3205002, 3205309, 3205200, 3201308


def cnpj(n: int) -> str:
    base = f'{70000000 + n:08d}0001'
    digits = [int(c) for c in base]
    for weights in ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]):
        r = sum(d * w for d, w in zip(digits, weights)) % 11
        digits.append(0 if r < 2 else 11 - r)
    s = ''.join(map(str, digits))
    return f'{s[:2]}.{s[2:5]}.{s[5:8]}/{s[8:12]}-{s[12:]}'


def write(name: str, header: list[str], rows: list[list[str]]) -> None:
    with open(os.path.join(OUT, name), 'w', encoding='utf-8-sig', newline='') as fh:
        fh.write(';'.join(header) + '\r\n')
        for row in rows:
            fh.write(';'.join(row) + '\r\n')


# (município, bairro, quantidade, rede nas primeiras N, grupo econômico na primeira?)
AREAS = [
    (SERRA, 'Laranjeiras', 8, 2, False),
    (SERRA, 'Jacaraípe', 6, 0, False),
    (SERRA, 'Carapina', 4, 0, True),
    (VITORIA, 'Centro', 6, 1, False),
    (VITORIA, 'Jardim Camburi', 6, 2, True),
    (VITORIA, 'Praia do Canto', 4, 0, False),
    (VILA_VELHA, 'Praia da Costa', 5, 1, False),
    (VILA_VELHA, 'Itapuã', 3, 0, False),
    (CARIACICA, 'Campo Grande', 6, 0, True),
]
PREFIXES = ['Farmácia', 'Drogaria', 'Drogaria Popular', 'Farmácia Bem Viver', 'Drogaria Saúde', 'Farmácia Central']

SUBGROUPS = [('GEN', 'Genéricos'), ('MIP', 'Medicamentos isentos de prescrição'),
             ('DERM', 'Dermocosméticos'), ('FRIO', 'Refrigerados (cadeia fria)')]
SELLERS = [('V101', 'Ana Martins'), ('V102', 'Bruno Costa'), ('V103', 'Carla Nunes'), ('V104', 'Diego Alves'),
           ('V105', 'Elisa Rocha'), ('V106', 'Fábio Teixeira'), ('V107', 'Gabriela Pires')]

PORTFOLIOS = [
    # nome, tipo, responsável, descrição, regiões, redes, vendedores
    ('Serra Norte', 'GEO', 'demo-gestor', 'Farmácias de Laranjeiras e Jacaraípe.',
     f'ES/{SERRA}/Laranjeiras|ES/{SERRA}/Jacaraípe', '', 'GEN:V101|GEN:V102|MIP:V103|DERM:V104'),
    ('Grande Vitória', 'GEO', 'demo-gestor', 'Vitória e Vila Velha.',
     f'ES/{VITORIA}|ES/{VILA_VELHA}', '', 'GEN:V105|MIP:V106'),
    ('Vitória Centro', 'GEO', 'demo-admin', 'Rascunho que disputa Vitória com a Grande Vitória.',
     f'ES/{VITORIA}', '', 'GEN:V106'),
    ('Rede FarmaVida', 'REDE', 'demo-admin', 'Todas as lojas da rede, onde estiverem.',
     '', 'RD-FARMAVIDA', 'GEN:V107|FRIO:V107'),
]


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    write('01-branches.csv', ['codigo', 'nome', 'municipio_ibge', 'ativo'],
          [[BRANCH, 'GMill Serra (demonstração)', str(SERRA), 'S']])
    write('02-product-subgroups.csv', ['codigo', 'nome', 'ativo'], [[c, n, 'S'] for c, n in SUBGROUPS])
    write('03-retail-networks.csv', ['codigo', 'nome', 'ativo'],
          [['RD-FARMAVIDA', 'Rede FarmaVida (fictícia)', 'S'], ['RD-BEMESTAR', 'Rede Bem-Estar (fictícia)', 'S']])
    write('04-economic-groups.csv', ['codigo', 'nome', 'ativo'], [['GE-SAUDEMAIS', 'Grupo Saúde Mais (fictício)', 'S']])
    write('05-sellers.csv', ['codigo', 'nome', 'filiais', 'ativo'], [[c, n, BRANCH, 'S'] for c, n in SELLERS])

    customers, n = [], 0
    for municipality, neighborhood, count, network, group in AREAS:
        for i in range(count):
            n += 1
            in_network = i < network
            prefix = 'FarmaVida' if in_network else PREFIXES[n % len(PREFIXES)]
            trade = f'{prefix} {neighborhood} {i + 1}'
            legal = f'{trade} Comércio de Medicamentos Ltda'
            customers.append([
                cnpj(n), legal, trade, str(municipality), neighborhood,
                'RD-FARMAVIDA' if in_network else '', 'GE-SAUDEMAIS' if group and i == 0 else '', BRANCH, 'S',
            ])
    write('06-customers.csv', ['cnpj', 'razao_social', 'nome_fantasia', 'municipio_ibge', 'bairro', 'rede_codigo',
                               'grupo_economico_codigo', 'filiais', 'ativo'], customers)
    write('07-portfolios.csv', ['filial_codigo', 'nome', 'tipo_codigo', 'responsavel_sub', 'descricao', 'regioes',
                                'redes', 'grupos_economicos', 'vendedores', 'ativo'],
          [[BRANCH, name, kind, resp, desc, regions, networks, '', sellers, 'S']
           for name, kind, resp, desc, regions, networks, sellers in PORTFOLIOS])
    print(f'{len(customers)} clientes; arquivos em {OUT}')


if __name__ == '__main__':
    main()
