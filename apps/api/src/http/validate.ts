import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses untrusted input with a zod schema, throwing a 400 envelope on failure. */
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw badRequest(
      'Request validation failed',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}
