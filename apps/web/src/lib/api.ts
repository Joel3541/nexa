import type { ApiError } from '@nexa/types';

/**
 * API client.
 *
 * Session state lives in an httpOnly cookie, so requests carry credentials and
 * the browser never sees a token. The active workspace travels in a header so
 * a user with several businesses can switch without re-authenticating.
 */

const BASE = '/api';
let activeBusinessId: string | null = null;

export function setActiveBusiness(businessId: string | null): void {
  activeBusinessId = businessId;
  if (businessId) localStorage.setItem('nexa.business', businessId);
  else localStorage.removeItem('nexa.business');
}

export function getActiveBusiness(): string | null {
  return activeBusinessId ?? localStorage.getItem('nexa.business');
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const businessId = getActiveBusiness();
  const response = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(businessId ? { 'x-nexa-business': businessId } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as ApiError | null)?.error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? 'Something went wrong. Please try again.',
      error?.fields,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
