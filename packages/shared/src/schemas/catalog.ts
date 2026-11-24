import { z } from 'zod';
import { ALLOCATION_STRATEGIES } from '../domain/allocation.js';
import { codeSchema } from './common.js';

export const uomLevelSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{0,9}$/),
  factor: z.number().int().min(2),
});

export const createSkuSchema = z.object({
  code: codeSchema,
  description: z.string().trim().min(1).max(240),
  baseUom: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{0,9}$/)
    .default('EA'),
  uomLevels: z.array(uomLevelSchema).max(6).default([]),
  lotTracked: z.boolean().default(false),
  expiryTracked: z.boolean().default(false),
  defaultStrategy: z.enum(ALLOCATION_STRATEGIES).default('FIFO'),
});
export type CreateSkuInput = z.infer<typeof createSkuSchema>;
