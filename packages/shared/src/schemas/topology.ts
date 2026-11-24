import { z } from 'zod';
import { codeSchema, nameSchema } from './common.js';

export const ZONE_TYPES = [
  'RECEIVING',
  'STORAGE',
  'PICK',
  'STAGING',
  'SHIPPING',
  'QUARANTINE',
] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export const createWarehouseSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  timezone: z.string().trim().min(1).max(64).default('UTC'),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const createZoneSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  zoneType: z.enum(ZONE_TYPES),
});
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

export const createBinSchema = z.object({
  zoneId: z.string().uuid(),
  code: z.string().trim().min(2).max(32),
  pickSequence: z.number().int().min(0).max(2_000_000_000).optional(),
  maxWeightGrams: z.number().int().positive().max(100_000_000).optional(),
  maxVolumeCm3: z.number().int().positive().max(1_000_000_000).optional(),
});
export type CreateBinInput = z.infer<typeof createBinSchema>;
