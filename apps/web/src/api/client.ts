import { createContext, useContext } from 'react';

/** Erro devolvido pela API (`{ error, message?, detail? }`) ou pela rede. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Mensagem fixa do domínio (nunca ecoa o valor enviado), quando a API a manda. */
  readonly apiMessage: string | null;
  readonly detail: Record<string, unknown> | null;

  constructor(
    status: number,
    code: string,
    apiMessage: string | null,
    detail: Record<string, unknown> | null,
  ) {
    super(apiMessage ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.apiMessage = apiMessage;
    this.detail = detail;
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface SendOptions {
  body?: unknown;
  query?: Query;
  /** Versão do agregado: vira `If-Match: "<versão>"`. */
  version?: number;
}

export interface Api {
  get<T>(path: string, query?: Query): Promise<T>;
  send<T>(method: 'POST' | 'PUT' | 'PATCH', path: string, options?: SendOptions): Promise<T>;
  /** Envia o arquivo cru como `text/csv` (sem ler no navegador: a API detecta a codificação pelos bytes). */
  upload<T>(path: string, query: Query, file: Blob): Promise<T>;
  /** Baixa um arquivo com o Bearer (o token nunca vai na URL). */
  download(path: string): Promise<{ blob: Blob; filename: string | null }>;
}

function buildUrl(apiBase: string, path: string, query?: Query): string {
  const base = `${apiBase.replace(/\/+$/, '')}${path}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

async function toError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Corpo vazio ou não JSON (ex.: 413 do proxy).
  }
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const code = typeof b.error === 'string' ? b.error : `http_${res.status}`;
  const message = typeof b.message === 'string' ? b.message : null;
  const detail =
    typeof b.detail === 'object' && b.detail !== null ? (b.detail as Record<string, unknown>) : null;
  return new ApiError(res.status, code, message, detail);
}

/** Nome do arquivo de `Content-Disposition: attachment; filename="x.csv"`. */
function filenameOf(header: string | null): string | null {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match ? match[1]! : null;
}

/**
 * Cliente da API v1. Todo 401 chama `onExpired` (o App garante um evento por token) e vira `ApiError`.
 * Falha de rede vira `ApiError` com `code: 'network_error'`.
 */
export function createApi(apiBase: string, token: string, onExpired: () => void): Api {
  async function call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw new ApiError(0, 'network_error', null, null);
    }
    if (res.status === 401) {
      onExpired();
      throw new ApiError(401, 'unauthorized', null, null);
    }
    if (!res.ok) throw await toError(res);
    return res;
  }

  return {
    async get<T>(path: string, query?: Query) {
      const res = await call(buildUrl(apiBase, path, query), { method: 'GET' });
      return (await res.json()) as T;
    },
    async send<T>(method: 'POST' | 'PUT' | 'PATCH', path: string, options: SendOptions = {}) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (options.version !== undefined) headers['If-Match'] = `"${options.version}"`;
      const res = await call(buildUrl(apiBase, path, options.query), {
        method,
        headers,
        body: JSON.stringify(options.body ?? {}),
      });
      return (await res.json()) as T;
    },
    async upload<T>(path: string, query: Query, file: Blob) {
      const res = await call(buildUrl(apiBase, path, query), {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: file,
      });
      return (await res.json()) as T;
    },
    async download(path: string) {
      const res = await call(buildUrl(apiBase, path), { method: 'GET' });
      return { blob: await res.blob(), filename: filenameOf(res.headers.get('Content-Disposition')) };
    },
  };
}

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('ApiContext ausente');
  return api;
}

/** Lê todas as páginas de uma listagem por cursor (para listas de seleção), com teto de segurança. */
export async function listAll<T>(api: Api, path: string, query: Query = {}, maxItems = 2000): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: T[]; nextCursor: string | null } = await api.get(path, {
      ...query,
      limit: 200,
      cursor,
    });
    if (!Array.isArray(page?.items)) throw new ApiError(0, 'bad_response', null, null);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && items.length < maxItems);
  return items;
}
