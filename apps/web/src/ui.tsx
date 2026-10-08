import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { describeError } from './api/errors';

/** Aviso de erro ou sucesso. Erro usa `role="alert"` para leitor de tela. */
export function Notice({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className={`gc-notice gc-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="gc-field">
      <span className="gc-field-label">{label}</span>
      {children}
      {hint && <span className="gc-field-hint">{hint}</span>}
    </label>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'bad';
  children: ReactNode;
}) {
  return <span className={`gc-badge gc-badge-${tone}`}>{children}</span>;
}

/** CNPJ com máscara (só exibição). */
export function formatCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatDateTime(epochMs: number | null | undefined): string {
  if (!epochMs) return '—';
  return new Date(epochMs).toLocaleString('pt-BR');
}

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Executa `load` quando `deps` mudam e guarda o resultado. Ignora a resposta de uma execução que já foi
 * substituída por outra (troca rápida de filtro).
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): Async<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadRef.current().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (err: unknown) => alive && setState({ data: null, error: describeError(err), loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

export interface Paged<T> {
  items: T[];
  total: number | null;
  error: string | null;
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * Lista paginada por cursor com "Carregar mais". Recomeça do zero quando `deps` mudam; uma página que
 * chega depois da troca de filtro é descartada.
 */
export function usePaged<T>(
  loadPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null; total?: number }>,
  deps: readonly unknown[],
): Paged<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  const loadRef = useRef(loadPage);
  loadRef.current = loadPage;

  const fetchPage = useCallback((from: string | null, append: boolean) => {
    const gen = generation.current;
    setLoading(true);
    setError(null);
    loadRef.current(from).then(
      (page) => {
        if (gen !== generation.current) return;
        if (!page || !Array.isArray(page.items)) {
          setError('Resposta inesperada do serviço.');
          setLoading(false);
          return;
        }
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setTotal(page.total ?? null);
        setLoading(false);
      },
      (err: unknown) => {
        if (gen !== generation.current) return;
        setError(describeError(err));
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    generation.current += 1;
    setItems([]);
    setCursor(null);
    setTotal(null);
    fetchPage(null, false);
  }, [...deps, tick]);

  return {
    items,
    total,
    error,
    loading,
    hasMore: cursor !== null,
    loadMore: () => cursor && fetchPage(cursor, true),
    reload: () => setTick((n) => n + 1),
  };
}

export function LoadMore({ paged }: { paged: Paged<unknown> }) {
  return (
    <div className="gc-pager">
      {paged.loading && <span>Carregando…</span>}
      {!paged.loading && paged.hasMore && (
        <button type="button" className="gc-button gc-button-secondary" onClick={paged.loadMore}>
          Carregar mais
        </button>
      )}
      {paged.total !== null && (
        <span className="gc-muted">
          {paged.items.length} de {paged.total}
        </span>
      )}
    </div>
  );
}

/** Texto de busca com atraso, para não chamar a API a cada tecla. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Isola falhas de renderização de uma tela (ex.: resposta fora do contrato) sem derrubar o componente inteiro.
 * Não registra o erro: a mensagem pode trazer dado de negócio da resposta.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="gc-notice gc-notice-error">
        Erro inesperado nesta tela.{' '}
        <button type="button" className="gc-link" onClick={() => this.setState({ failed: false })}>
          Tentar de novo
        </button>
      </div>
    );
  }
}
