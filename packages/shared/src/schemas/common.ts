import { z } from 'zod';
import { MAX_QUANTITY } from '../domain/quantity.js';

export const uuidSchema = z.string().uuid();
export const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'Use letters, digits, dot, dash or underscore')
  .transform((value) => value.toUpperCase());
export const nameSchema = z.string().trim().min(1).max(120);
export const quantitySchema = z.number().int().positive().max(MAX_QUANTITY);
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const limitSchema = z.coerce.number().int().min(1).max(200).default(50);
