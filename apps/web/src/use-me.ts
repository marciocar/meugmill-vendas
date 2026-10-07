import { useCallback, useEffect, useRef, useState } from 'react';

/** Resposta de `GET /v1/me`. */
export interface Me {
  sub: string;
  roles: string[];
  branchIds: string[];
}

export type MeState =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'authenticated'; me: Me }
  | { status: 'expired' }
  | { status: 'unavailable' };

interface UseMeResult {
  state: MeState;
  /** Refaz a busca (usado no estado "indisponível"). */
  retry: () => void;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((i) => typeof i === 'string');

/** Valida o corpo de `/v1/me`; null se faltar `sub` (string não vazia) ou se roles/branchIds não forem listas. */
function parseMe(body: unknown): Me | null {
  if (typeof body !== 'object' || body === null) return null;
  const { sub, roles, branchIds } = body as Record<string, unknown>;
  if (typeof sub !== 'string' || sub.trim() === '') return null;
  if (!isStringArray(roles) || !isStringArray(branchIds)) return null;
  return { sub, roles, branchIds };
}

/**
 * Busca `/v1/me` quando `apiBase` e `token` estão presentes. Refaz a busca ao
 * mudar qualquer um dos dois e aborta a requisição anterior. Em 401 chama
 * `onExpired` no máximo UMA vez por token (sem loop).
 */
export function useMe(apiBase: string | null, token: string | null, onExpired: () => void): UseMeResult {
  const [state, setState] = useState<MeState>({ status: 'unconfigured' });
  const [attempt, setAttempt] = useState(0);
  const expiredFor = useRef<string | null>(null);
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onExpiredRef.current = onExpired;
  });

  useEffect(() => {
    if (!apiBase || !token) {
      setState({ status: 'unconfigured' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    const url = `${apiBase.replace(/\/+$/, '')}/v1/me`;

    fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (res) => {
        if (controller.signal.aborted) return;
        if (res.status === 401) {
          setState({ status: 'expired' });
          if (expiredFor.current !== token) {
            expiredFor.current = token;
            onExpiredRef.current();
          }
          return;
        }
        if (!res.ok) {
          setState({ status: 'unavailable' });
          return;
        }
        const me = parseMe(await res.json());
        if (controller.signal.aborted) return;
        // 200 com corpo inválido não é "autenticado": trata como indisponível.
        setState(me ? { status: 'authenticated', me } : { status: 'unavailable' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'unavailable' });
      });

    return () => controller.abort();
  }, [apiBase, token, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
