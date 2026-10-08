/** Vendedor candidato de um subgrupo (já filtrado: ativo, com vínculo ativo e par na carteira). */
export interface StrategySeller {
  id: number;
  code: string;
}

export interface StrategyInput {
  /** Candidatos do subgrupo, em qualquer ordem. */
  sellers: StrategySeller[];
  /** Atribuições VÁLIDAS por vendedor no subgrupo, antes desta distribuição (ausente = 0). */
  validCounts: ReadonlyMap<number, number>;
  /** Clientes a preencher, em ordem crescente de id. */
  customerIds: readonly number[];
}

/**
 * Estratégia de distribuição de UM subgrupo. Função pura e determinística: devolve o vendedor de cada
 * cliente de `customerIds` (mesma posição). Trocar por rodízio ou faturamento é criar outra
 * implementação; o serviço não conhece a regra de escolha.
 */
export interface DistributionStrategy {
  readonly name: string;
  assign(input: StrategyInput): number[];
}
