import { DomainError } from './errors.js';
import { assertQuantity, MAX_QUANTITY } from './quantity.js';

/**
 * Unit-of-measure ladder for a SKU (ADR-0008).
 *
 * Every SKU has one base unit (factor 1, e.g. EA). Pack levels are expressed as an
 * integer number of base units (CS = 12 EA, PL = 480 EA). Ladders must be *nested*:
 * each level is a whole multiple of the level below it, which mirrors physical
 * packaging (a pallet holds whole cases) and guarantees that greedy decomposition
 * is exact.
 */
export interface UomLevel {
  readonly code: string;
  readonly factor: number;
}

export interface UomLadder {
  readonly baseUom: string;
  readonly levels: readonly UomLevel[];
}

const UOM_CODE = /^[A-Z][A-Z0-9]{0,9}$/;

export function isValidUomCode(code: string): boolean {
  return UOM_CODE.test(code);
}

/** Validates and returns a normalised ladder (levels sorted ascending by factor). */
export function createUomLadder(baseUom: string, levels: readonly UomLevel[]): UomLadder {
  if (!isValidUomCode(baseUom)) {
    throw new DomainError('INVALID_UOM_LADDER', `Invalid base unit code "${baseUom}"`);
  }
  const sorted = [...levels].sort((a, b) => a.factor - b.factor);
  const seen = new Set<string>([baseUom]);
  let previousFactor = 1;
  for (const level of sorted) {
    if (!isValidUomCode(level.code)) {
      throw new DomainError('INVALID_UOM_LADDER', `Invalid unit code "${level.code}"`);
    }
    if (seen.has(level.code)) {
      throw new DomainError('INVALID_UOM_LADDER', `Duplicate unit code "${level.code}"`);
    }
    if (!Number.isSafeInteger(level.factor) || level.factor < 2 || level.factor > MAX_QUANTITY) {
      throw new DomainError(
        'INVALID_UOM_LADDER',
        `Unit "${level.code}" must contain a whole number (>= 2) of base units`,
      );
    }
    if (level.factor % previousFactor !== 0 || level.factor === previousFactor) {
      throw new DomainError(
        'INVALID_UOM_LADDER',
        `Unit "${level.code}" (${level.factor}) is not a whole multiple of the level below (${previousFactor})`,
      );
    }
    seen.add(level.code);
    previousFactor = level.factor;
  }
  return Object.freeze({
    baseUom,
    levels: Object.freeze(sorted.map((level) => Object.freeze({ ...level }))),
  });
}

export function factorOf(ladder: UomLadder, uom: string): number {
  if (uom === ladder.baseUom) return 1;
  const level = ladder.levels.find((candidate) => candidate.code === uom);
  if (!level) {
    throw new DomainError('INVALID_UOM', `Unit "${uom}" is not defined for this SKU`, {
      uom,
      allowed: [ladder.baseUom, ...ladder.levels.map((l) => l.code)],
    });
  }
  return level.factor;
}

/** Converts a whole quantity in `uom` to base units, rejecting overflow. */
export function toBaseUnits(ladder: UomLadder, quantity: number, uom: string): number {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new DomainError('INVALID_QUANTITY', 'Quantity must be a positive whole number', {
      quantity,
    });
  }
  return assertQuantity(quantity * factorOf(ladder, uom));
}

/**
 * Converts between two units of the same ladder. Throws when the result would be
 * fractional (e.g. 18 EA -> CS when a case holds 12) instead of silently rounding.
 */
export function convertQuantity(
  ladder: UomLadder,
  quantity: number,
  fromUom: string,
  toUom: string,
): number {
  const base = toBaseUnits(ladder, quantity, fromUom);
  const factor = factorOf(ladder, toUom);
  if (base % factor !== 0) {
    throw new DomainError(
      'NON_INTEGRAL_CONVERSION',
      `${quantity} ${fromUom} is not a whole number of ${toUom}`,
      { quantity, fromUom, toUom, baseUnits: base, factor },
    );
  }
  return base / factor;
}

export interface UomBreakdownPart {
  readonly uom: string;
  readonly quantity: number;
}

/**
 * Decomposes a base quantity into the largest pack levels first
 * (e.g. 1000 EA -> 2 PL + 3 CS + 4 EA). Because ladders are nested the greedy
 * decomposition is optimal (fewest handling units) and exact. O(levels).
 */
export function breakdownQuantity(ladder: UomLadder, baseQuantity: number): UomBreakdownPart[] {
  if (!Number.isSafeInteger(baseQuantity) || baseQuantity < 0) {
    throw new DomainError('INVALID_QUANTITY', 'Base quantity must be a non-negative integer', {
      baseQuantity,
    });
  }
  const parts: UomBreakdownPart[] = [];
  let remaining = baseQuantity;
  for (const level of [...ladder.levels].reverse()) {
    const count = Math.floor(remaining / level.factor);
    if (count > 0) {
      parts.push({ uom: level.code, quantity: count });
      remaining -= count * level.factor;
    }
  }
  if (remaining > 0 || parts.length === 0) {
    parts.push({ uom: ladder.baseUom, quantity: remaining });
  }
  return parts;
}

export function formatBreakdown(parts: readonly UomBreakdownPart[]): string {
  return parts.map((part) => `${part.quantity} ${part.uom}`).join(' + ');
}
