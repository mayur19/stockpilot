import type { ApiEnvelope, ApiError } from '@stockpilot/shared';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

const CSRF_COOKIE = 'sp_csrf';

export function readCsrfToken(cookieString: string = document.cookie): string | null {
  for (const part of cookieString.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Thin fetch wrapper: sends cookies, echoes the CSRF token, unwraps the envelope. */
export async function apiRequest<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCsrfToken();
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return undefined as T;
  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !envelope || envelope.error) {
    throw new ApiRequestError(
      response.status,
      envelope?.error ?? { code: 'NETWORK_ERROR', message: `Request failed (${response.status})` },
    );
  }
  return envelope.data as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => apiRequest<T>('POST', path, body),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (Array.isArray(error.details) && error.code === 'VALIDATION_FAILED') {
      const first = error.details[0] as { path?: string; message?: string } | undefined;
      if (first?.message)
        return `${error.message}: ${first.path ? `${first.path} ` : ''}${first.message}`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}
