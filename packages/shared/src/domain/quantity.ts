import { DomainError } from './errors.js';

/**
 * Quantities are always whole numbers of a SKU's base unit of measure (ADR-0008).
 * The ceiling keeps every intermediate sum well inside Number.MAX_SAFE_INTEGER, so
 * ledger arithmetic never loses precision even when thousands of movements are folded.
 */
export const MAX_QUANTITY = 1_000_000_000_000;

export function isValidQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_QUANTITY;
}

export function assertQuantity(value: number, field = 'quantity'): number {
  if (!isValidQuantity(value)) {
    throw new DomainError(
      'INVALID_QUANTITY',
      `${field} must be a positive whole number no greater than ${MAX_QUANTITY}`,
      { field, value },
    );
  }
  return value;
}

/** Checked addition for non-negative balances. */
export function addQuantities(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new DomainError('INVALID_QUANTITY', 'Quantity overflow', { a, b });
  }
  return sum;
}
