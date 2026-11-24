import type { ApiEnvelope } from '@stockpilot/shared';

export function ok<T>(data: T, meta?: Record<string, unknown>): ApiEnvelope<T> {
  return meta ? { data, error: null, meta } : { data, error: null };
}
