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
        const body = (await res.json()) as Partial<Me>;
        if (controller.signal.aborted) return;
        setState({
          status: 'authenticated',
          me: {
            sub: String(body.sub ?? ''),
            roles: Array.isArray(body.roles) ? body.roles : [],
            branchIds: Array.isArray(body.branchIds) ? body.branchIds : [],
          },
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'unavailable' });
      });

    return () => controller.abort();
  }, [apiBase, token, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
