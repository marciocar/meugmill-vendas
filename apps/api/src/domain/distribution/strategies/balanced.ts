import type { DistributionStrategy, StrategyInput } from './strategy.js';

/**
 * Equilíbrio por quantidade: cada cliente vai para o vendedor com MENOS clientes no subgrupo
 * (contando os já atribuídos e os desta passada); empate pelo menor código. Os clientes chegam em ordem
 * de id. Min-heap sobre (contagem, posição do código): O(n log k).
 */
export const balancedStrategy: DistributionStrategy = {
  name: 'balanced',
  assign({ sellers, validCounts, customerIds }: StrategyInput): number[] {
    if (sellers.length === 0) throw new Error('balanced: subgrupo sem vendedor');
    // Posição no vetor ordenado por código é o desempate (código é único).
    const ordered = [...sellers].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    const ids = ordered.map((s) => s.id);
    const count = ids.map((id) => validCounts.get(id) ?? 0);
    const heap = ids.map((_, i) => i);
    const less = (a: number, b: number) =>
      (count[a] as number) < (count[b] as number) || (count[a] === count[b] && a < b);

    const siftDown = (start: number) => {
      let i = start;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l] as number, heap[m] as number)) m = l;
        if (r < heap.length && less(heap[r] as number, heap[m] as number)) m = r;
        if (m === i) return;
        [heap[i], heap[m]] = [heap[m] as number, heap[i] as number];
        i = m;
      }
    };
    for (let i = (heap.length >> 1) - 1; i >= 0; i--) siftDown(i);

    const out: number[] = new Array<number>(customerIds.length);
    for (let n = 0; n < customerIds.length; n++) {
      const top = heap[0] as number;
      out[n] = ids[top] as number;
      count[top] = (count[top] as number) + 1;
      siftDown(0);
    }
    return out;
  },
};
