import { DomainError } from './errors.js';
import { addQuantities, assertQuantity } from './quantity.js';

/**
 * Event-sourced inventory ledger (ADR-0009).
 *
 * The append-only `inventory_movements` table is the source of truth. Every movement
 * expands into one or two *effects* on a stock balance keyed by (bin, sku, lot).
 * The `stock_balances` table is a projection of those effects that is updated in the
 * same transaction as the append, and can be rebuilt at any time by folding the
 * ledger with `projectBalances`.
 *
 * Quantities on movements are always positive; direction is carried by the type
 * and by which of fromBinId / toBinId is set.
 */
export const MOVEMENT_TYPES = [
  'RECEIPT',
  'MOVE',
  'ADJUST_IN',
  'ADJUST_OUT',
  'ALLOCATE',
  'DEALLOCATE',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface Movement {
  readonly type: MovementType;
  readonly skuId: string;
  readonly lotId: string;
  readonly fromBinId: string | null;
  readonly toBinId: string | null;
  readonly quantity: number;
}

export interface BalanceKey {
  readonly binId: string;
  readonly skuId: string;
  readonly lotId: string;
}

export interface Balance extends BalanceKey {
  readonly onHand: number;
  readonly allocated: number;
}

export type EffectKind = 'ON_HAND_IN' | 'ON_HAND_OUT' | 'ALLOCATE' | 'DEALLOCATE';

export interface BalanceEffect extends BalanceKey {
  readonly kind: EffectKind;
  readonly quantity: number;
}

export function balanceKeyOf(key: BalanceKey): string {
  return `${key.binId}|${key.skuId}|${key.lotId}`;
}

export function emptyBalance(key: BalanceKey): Balance {
  return { binId: key.binId, skuId: key.skuId, lotId: key.lotId, onHand: 0, allocated: 0 };
}

export function availableOf(balance: Balance): number {
  return balance.onHand - balance.allocated;
}

function requireBin(binId: string | null, role: string, movement: Movement): string {
  if (!binId) {
    throw new DomainError('INVALID_MOVEMENT', `${movement.type} requires a ${role} bin`, {
      type: movement.type,
    });
  }
  return binId;
}

function forbidBin(binId: string | null, role: string, movement: Movement): void {
  if (binId) {
    throw new DomainError('INVALID_MOVEMENT', `${movement.type} must not have a ${role} bin`, {
      type: movement.type,
    });
  }
}

/** Expands a movement into the balance effects it causes, validating its shape. */
export function effectsOf(movement: Movement): BalanceEffect[] {
  const quantity = assertQuantity(movement.quantity);
  const base = { skuId: movement.skuId, lotId: movement.lotId, quantity };
  switch (movement.type) {
    case 'RECEIPT':
    case 'ADJUST_IN': {
      forbidBin(movement.fromBinId, 'source', movement);
      return [
        {
          ...base,
          binId: requireBin(movement.toBinId, 'destination', movement),
          kind: 'ON_HAND_IN',
        },
      ];
    }
    case 'ADJUST_OUT': {
      forbidBin(movement.toBinId, 'destination', movement);
      return [
        { ...base, binId: requireBin(movement.fromBinId, 'source', movement), kind: 'ON_HAND_OUT' },
      ];
    }
    case 'MOVE': {
      const from = requireBin(movement.fromBinId, 'source', movement);
      const to = requireBin(movement.toBinId, 'destination', movement);
      if (from === to) {
        throw new DomainError('INVALID_MOVEMENT', 'Source and destination bins must differ');
      }
      return [
        { ...base, binId: from, kind: 'ON_HAND_OUT' },
        { ...base, binId: to, kind: 'ON_HAND_IN' },
      ];
    }
    case 'ALLOCATE':
    case 'DEALLOCATE': {
      forbidBin(movement.toBinId, 'destination', movement);
      return [
        {
          ...base,
          binId: requireBin(movement.fromBinId, 'source', movement),
          kind: movement.type === 'ALLOCATE' ? 'ALLOCATE' : 'DEALLOCATE',
        },
      ];
    }
    default: {
      const unknownType: never = movement.type;
      throw new DomainError('INVALID_MOVEMENT', `Unknown movement type ${String(unknownType)}`);
    }
  }
}

/**
 * Applies one effect to a balance and returns a new balance. Enforces the two ledger
 * invariants: on-hand never goes negative, and allocated never exceeds on-hand
 * (i.e. available = on-hand - allocated is never negative).
 */
export function applyEffect(balance: Balance, effect: BalanceEffect): Balance {
  const available = availableOf(balance);
  switch (effect.kind) {
    case 'ON_HAND_IN':
      return { ...balance, onHand: addQuantities(balance.onHand, effect.quantity) };
    case 'ON_HAND_OUT':
      if (effect.quantity > available) {
        throw new DomainError('INSUFFICIENT_AVAILABLE', 'Not enough available stock in bin', {
          binId: balance.binId,
          lotId: balance.lotId,
          requested: effect.quantity,
          available,
        });
      }
      return { ...balance, onHand: balance.onHand - effect.quantity };
    case 'ALLOCATE':
      if (effect.quantity > available) {
        throw new DomainError('INSUFFICIENT_AVAILABLE', 'Not enough available stock to allocate', {
          binId: balance.binId,
          lotId: balance.lotId,
          requested: effect.quantity,
          available,
        });
      }
      return { ...balance, allocated: balance.allocated + effect.quantity };
    case 'DEALLOCATE':
      if (effect.quantity > balance.allocated) {
        throw new DomainError('INSUFFICIENT_ALLOCATED', 'Cannot release more than is allocated', {
          binId: balance.binId,
          lotId: balance.lotId,
          requested: effect.quantity,
          allocated: balance.allocated,
        });
      }
      return { ...balance, allocated: balance.allocated - effect.quantity };
  }
}

/**
 * Folds an ordered sequence of movements into balances. The working Map is local
 * to this call and never escapes mutable, so the function stays referentially
 * transparent. O(m) for m movements.
 */
export function projectBalances(movements: Iterable<Movement>): ReadonlyMap<string, Balance> {
  const balances = new Map<string, Balance>();
  for (const movement of movements) {
    for (const effect of effectsOf(movement)) {
      const key = balanceKeyOf(effect);
      const current = balances.get(key) ?? emptyBalance(effect);
      balances.set(key, applyEffect(current, effect));
    }
  }
  return balances;
}

export interface BalanceMismatch {
  readonly key: BalanceKey;
  readonly expected: { readonly onHand: number; readonly allocated: number };
  readonly actual: { readonly onHand: number; readonly allocated: number };
}

/**
 * Compares a ledger-derived projection with stored balances. Rows with zero on-hand
 * and zero allocated are treated as absent on both sides.
 */
export function diffBalances(
  expected: ReadonlyMap<string, Balance>,
  actual: readonly Balance[],
): BalanceMismatch[] {
  const isEmpty = (b: Balance | undefined): boolean => !b || (b.onHand === 0 && b.allocated === 0);
  const actualByKey = new Map(actual.map((balance) => [balanceKeyOf(balance), balance] as const));
  const keys = new Set([...expected.keys(), ...actualByKey.keys()]);
  const mismatches: BalanceMismatch[] = [];
  for (const key of [...keys].sort()) {
    const exp = expected.get(key);
    const act = actualByKey.get(key);
    if (isEmpty(exp) && isEmpty(act)) continue;
    const e = exp ?? emptyBalance((act ?? exp) as BalanceKey);
    const a = act ?? emptyBalance(e);
    if (e.onHand !== a.onHand || e.allocated !== a.allocated) {
      mismatches.push({
        key: { binId: e.binId, skuId: e.skuId, lotId: e.lotId },
        expected: { onHand: e.onHand, allocated: e.allocated },
        actual: { onHand: a.onHand, allocated: a.allocated },
      });
    }
  }
  return mismatches;
}
