/** Consistent JSON envelope used by every API response (ADR-0005). */
export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface ApiEnvelope<T> {
  readonly data: T | null;
  readonly error: ApiError | null;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface PageMeta {
  readonly limit: number;
  readonly nextCursor: string | null;
}
