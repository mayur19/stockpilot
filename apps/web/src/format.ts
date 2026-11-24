import { breakdownQuantity, createUomLadder, formatBreakdown } from '@stockpilot/shared';
import type { Sku } from './api/types';

/** "1000" -> "2 PL + 3 CS + 4 EA" using the SKU's own UoM ladder. */
export function describeQuantity(
  quantity: number,
  sku: Pick<Sku, 'baseUom' | 'uomLevels'> | undefined,
): string {
  if (!sku || quantity === 0) return `${quantity}${sku ? ` ${sku.baseUom}` : ''}`;
  return formatBreakdown(breakdownQuantity(createUomLadder(sku.baseUom, sku.uomLevels), quantity));
}

export function daysUntil(isoDate: string, today: Date = new Date()): number {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - start) / 86_400_000);
}
