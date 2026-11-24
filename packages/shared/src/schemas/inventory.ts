import { z } from 'zod';
import { ALLOCATION_STRATEGIES } from '../domain/allocation.js';
import { isoDateSchema, limitSchema, quantitySchema, uuidSchema } from './common.js';

const uomSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{0,9}$/)
  .optional();
const referenceSchema = z.string().trim().max(64).optional();

export const receiptSchema = z.object({
  warehouseId: uuidSchema,
  binId: uuidSchema,
  skuId: uuidSchema,
  quantity: quantitySchema,
  uom: uomSchema,
  lotCode: z.string().trim().min(1).max(40).optional(),
  expiryDate: isoDateSchema.optional(),
  reference: referenceSchema,
});
export type ReceiptInput = z.infer<typeof receiptSchema>;

export const moveSchema = z.object({
  warehouseId: uuidSchema,
  fromBinId: uuidSchema,
  toBinId: uuidSchema,
  skuId: uuidSchema,
  lotId: uuidSchema,
  quantity: quantitySchema,
  uom: uomSchema,
  reference: referenceSchema,
});
export type MoveInput = z.infer<typeof moveSchema>;

export const ADJUSTMENT_REASONS = ['DAMAGED', 'FOUND', 'LOST', 'EXPIRED', 'CORRECTION'] as const;

export const adjustmentSchema = z.object({
  warehouseId: uuidSchema,
  binId: uuidSchema,
  skuId: uuidSchema,
  lotId: uuidSchema,
  delta: z
    .number()
    .int()
    .refine((value) => value !== 0, 'delta must not be zero'),
  reason: z.enum(ADJUSTMENT_REASONS),
  note: z.string().trim().max(240).optional(),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const balanceQuerySchema = z.object({
  warehouseId: uuidSchema,
  skuId: uuidSchema.optional(),
  binId: uuidSchema.optional(),
  includeEmpty: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  limit: limitSchema,
});
export type BalanceQuery = z.infer<typeof balanceQuerySchema>;

export const movementQuerySchema = z.object({
  warehouseId: uuidSchema,
  skuId: uuidSchema.optional(),
  binId: uuidSchema.optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: limitSchema,
});
export type MovementQuery = z.infer<typeof movementQuerySchema>;

export const allocationSchema = z.object({
  warehouseId: uuidSchema,
  orderRef: z.string().trim().min(1).max(64),
  strategy: z.enum(ALLOCATION_STRATEGIES).optional(),
  shipComplete: z.boolean().default(false),
  minShelfLifeDays: z.number().int().min(0).max(3650).optional(),
  lines: z
    .array(
      z.object({
        skuId: uuidSchema,
        quantity: quantitySchema,
        uom: uomSchema,
      }),
    )
    .min(1)
    .max(200),
});
export type AllocationInput = z.infer<typeof allocationSchema>;
