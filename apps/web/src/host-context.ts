import { createContext, useContext } from 'react';

/** Serviços que o custom element expõe à árvore React. */
export interface HostContextValue {
  /** Nó DENTRO do shadow root onde portais devem renderizar (herda o CSS isolado). */
  portalContainer: HTMLElement | null;
  /** Dispara o evento DOM `token-expired` para o host. */
  emitTokenExpired: () => void;
}

export const HostContext = createContext<HostContextValue>({
  portalContainer: null,
  emitTokenExpired: () => {},
});

export function useHost(): HostContextValue {
  return useContext(HostContext);
}
