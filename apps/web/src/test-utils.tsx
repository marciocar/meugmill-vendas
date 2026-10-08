import { act } from 'react';
import { vi } from 'vitest';
import { GmillCarteiraElement, TAG_NAME } from './element';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const page = <T,>(items: T[], total = items.length) => ({ items, nextCursor: null, total });

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

/**
 * `fetch` falso com rotas por método e caminho (regex sobre o path, sem query). Rota não cadastrada
 * devolve vazio no formato da rota, para as telas que não interessam ao teste. Guarda as chamadas.
 */
export function routeFetch(routes: [string, RegExp, Handler][]) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : init.body === undefined
          ? undefined
          : init.body;
    const call: Call = {
      method,
      path: url.pathname,
      query: url.searchParams,
      headers: (init.headers ?? {}) as Record<string, string>,
      body,
    };
    calls.push(call);
    for (const [m, re, handler] of routes) {
      if (m === method && re.test(url.pathname)) return handler(call);
    }
    if (method === 'GET' && url.pathname.endsWith('/geo/states')) return json(200, []);
    if (method === 'GET' && url.pathname.endsWith('/overrides'))
      return json(200, { include: [], exclude: [] });
    if (method === 'GET') return json(200, page([]));
    return json(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export async function mountWith(token = 'tok'): Promise<GmillCarteiraElement> {
  const el = document.createElement(TAG_NAME) as GmillCarteiraElement;
  await act(async () => {
    document.body.appendChild(el);
  });
  await act(async () => {
    el.apiBase = 'http://api';
    el.token = token;
  });
  await settle();
  return el;
}

/** Deixa as promessas e os timers curtos (debounce de 300 ms) andarem. */
export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

export const text = (el: GmillCarteiraElement) => el.shadowRoot?.textContent ?? '';

export function button(el: GmillCarteiraElement, label: string | RegExp): HTMLButtonElement {
  const found = [...(el.shadowRoot?.querySelectorAll('button') ?? [])].find((b) =>
    typeof label === 'string' ? b.textContent?.trim() === label : label.test(b.textContent ?? ''),
  );
  if (!found) throw new Error(`botão não encontrado: ${label}`);
  return found;
}

export async function click(el: GmillCarteiraElement, label: string | RegExp): Promise<void> {
  const b = button(el, label);
  await act(async () => {
    b.click();
  });
  await settle();
}

/** Campo pelo texto do rótulo (`<label class="gc-field">`). */
export function field<T extends HTMLElement = HTMLInputElement>(el: GmillCarteiraElement, label: string): T {
  const labels = [...(el.shadowRoot?.querySelectorAll('label.gc-field') ?? [])];
  const found = labels.find((l) => l.querySelector('.gc-field-label')?.textContent === label);
  const control = found?.querySelector('input, select, textarea');
  if (!control) throw new Error(`campo não encontrado: ${label}`);
  return control as T;
}

/** Muda o valor como o usuário (o React escuta o setter nativo + evento). */
export async function type(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const proto = Object.getPrototypeOf(control) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  await act(async () => {
    setter?.call(control, value);
    control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  await settle();
}
