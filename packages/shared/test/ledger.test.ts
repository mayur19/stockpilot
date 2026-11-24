import { describe, expect, it } from 'vitest';
import {
  applyEffect,
  availableOf,
  balanceKeyOf,
  diffBalances,
  DomainError,
  effectsOf,
  emptyBalance,
  projectBalances,
  type Balance,
  type Movement,
} from '../src/index.js';

const SKU = 'sku-1';
const LOT = 'lot-1';
const receipt = (bin: string, quantity: number): Movement => ({
  type: 'RECEIPT',
  skuId: SKU,
  lotId: LOT,
  fromBinId: null,
  toBinId: bin,
  quantity,
});
const move = (from: string, to: string, quantity: number): Movement => ({
  type: 'MOVE',
  skuId: SKU,
  lotId: LOT,
  fromBinId: from,
  toBinId: to,
  quantity,
});
const allocate = (bin: string, quantity: number, type: 'ALLOCATE' | 'DEALLOCATE' = 'ALLOCATE') => ({
  type,
  skuId: SKU,
  lotId: LOT,
  fromBinId: bin,
  toBinId: null,
  quantity,
});

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as DomainError).code;
  }
  return undefined;
}

function balanceAt(map: ReadonlyMap<string, Balance>, bin: string): Balance | undefined {
  return map.get(balanceKeyOf({ binId: bin, skuId: SKU, lotId: LOT }));
}

describe('effectsOf', () => {
  it('expands a move into an out and an in effect', () => {
    expect(effectsOf(move('A', 'B', 5)).map((e) => [e.binId, e.kind])).toEqual([
      ['A', 'ON_HAND_OUT'],
      ['B', 'ON_HAND_IN'],
    ]);
  });

  it('maps adjustments and allocations to single effects', () => {
    expect(effectsOf({ ...receipt('A', 1), type: 'ADJUST_IN' })[0]?.kind).toBe('ON_HAND_IN');
    expect(
      effectsOf({ ...receipt('A', 1), type: 'ADJUST_OUT', fromBinId: 'A', toBinId: null })[0]?.kind,
    ).toBe('ON_HAND_OUT');
    expect(effectsOf(allocate('A', 1))[0]?.kind).toBe('ALLOCATE');
    expect(effectsOf(allocate('A', 1, 'DEALLOCATE'))[0]?.kind).toBe('DEALLOCATE');
  });

  it.each<[string, Movement]>([
    ['receipt without destination', { ...receipt('A', 1), toBinId: null }],
    ['receipt with source', { ...receipt('A', 1), fromBinId: 'B' }],
    ['move to same bin', move('A', 'A', 1)],
    ['move without source', { ...move('A', 'B', 1), fromBinId: null }],
    ['allocate with destination', { ...allocate('A', 1), toBinId: 'B' }],
    ['adjust out without source', { ...receipt('A', 1), type: 'ADJUST_OUT', toBinId: null }],
  ])('rejects %s', (_label, movement) => {
    expect(errorCode(() => effectsOf(movement))).toBe('INVALID_MOVEMENT');
  });

  it('rejects non-positive quantities', () => {
    expect(errorCode(() => effectsOf(receipt('A', 0)))).toBe('INVALID_QUANTITY');
    expect(errorCode(() => effectsOf(receipt('A', -3)))).toBe('INVALID_QUANTITY');
  });
});

describe('applyEffect', () => {
  const base = {
    ...emptyBalance({ binId: 'A', skuId: SKU, lotId: LOT }),
    onHand: 10,
    allocated: 4,
  };

  it('returns a new object and leaves the input untouched', () => {
    const next = applyEffect(base, { ...base, kind: 'ON_HAND_IN', quantity: 5 });
    expect(next).not.toBe(base);
    expect(next.onHand).toBe(15);
    expect(base.onHand).toBe(10);
  });

  it('cannot remove allocated units', () => {
    expect(errorCode(() => applyEffect(base, { ...base, kind: 'ON_HAND_OUT', quantity: 7 }))).toBe(
      'INSUFFICIENT_AVAILABLE',
    );
    expect(applyEffect(base, { ...base, kind: 'ON_HAND_OUT', quantity: 6 }).onHand).toBe(4);
  });

  it('cannot allocate more than available', () => {
    expect(errorCode(() => applyEffect(base, { ...base, kind: 'ALLOCATE', quantity: 7 }))).toBe(
      'INSUFFICIENT_AVAILABLE',
    );
    expect(availableOf(applyEffect(base, { ...base, kind: 'ALLOCATE', quantity: 6 }))).toBe(0);
  });

  it('cannot release more than allocated', () => {
    expect(errorCode(() => applyEffect(base, { ...base, kind: 'DEALLOCATE', quantity: 5 }))).toBe(
      'INSUFFICIENT_ALLOCATED',
    );
    expect(applyEffect(base, { ...base, kind: 'DEALLOCATE', quantity: 4 }).allocated).toBe(0);
  });
});

describe('projectBalances', () => {
  it('folds receipts, moves and allocations', () => {
    const balances = projectBalances([
      receipt('A', 100),
      move('A', 'B', 30),
      allocate('B', 20),
      allocate('B', 5, 'DEALLOCATE'),
    ]);
    expect(balanceAt(balances, 'A')).toMatchObject({ onHand: 70, allocated: 0 });
    expect(balanceAt(balances, 'B')).toMatchObject({ onHand: 30, allocated: 15 });
  });

  it('throws when the ledger would drive stock negative', () => {
    expect(errorCode(() => projectBalances([receipt('A', 5), move('A', 'B', 6)]))).toBe(
      'INSUFFICIENT_AVAILABLE',
    );
  });

  it('conserves total on-hand across random moves', () => {
    let seed = 42;
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const bins = ['A', 'B', 'C', 'D'];
    const onHand = new Map<string, number>([['A', 1000]]);
    const movements: Movement[] = [receipt('A', 1000)];
    for (let i = 0; i < 500; i += 1) {
      const from = bins[random(4)] as string;
      const to = bins[random(4)] as string;
      const have = onHand.get(from) ?? 0;
      if (from === to || have === 0) continue;
      const qty = 1 + random(have);
      movements.push(move(from, to, qty));
      onHand.set(from, have - qty);
      onHand.set(to, (onHand.get(to) ?? 0) + qty);
    }
    const projected = projectBalances(movements);
    const total = [...projected.values()].reduce((sum, b) => sum + b.onHand, 0);
    expect(total).toBe(1000);
    for (const bin of bins)
      expect(balanceAt(projected, bin)?.onHand ?? 0).toBe(onHand.get(bin) ?? 0);
  });
});

describe('diffBalances', () => {
  const projected = projectBalances([receipt('A', 10), allocate('A', 3)]);

  it('reports no mismatches for an identical store', () => {
    expect(diffBalances(projected, [...projected.values()])).toEqual([]);
  });

  it('ignores empty rows on either side', () => {
    const emptyRow = emptyBalance({ binId: 'Z', skuId: SKU, lotId: LOT });
    expect(diffBalances(projected, [...projected.values(), emptyRow])).toEqual([]);
  });

  it('detects drift, missing rows and phantom rows', () => {
    const drifted = { ...(balanceAt(projected, 'A') as Balance), onHand: 9 };
    const phantom = { ...emptyBalance({ binId: 'P', skuId: SKU, lotId: LOT }), onHand: 2 };
    const mismatches = diffBalances(projected, [drifted, phantom]);
    expect(mismatches).toHaveLength(2);
    expect(mismatches.find((m) => m.key.binId === 'A')?.actual.onHand).toBe(9);
    expect(mismatches.find((m) => m.key.binId === 'P')?.expected.onHand).toBe(0);
    expect(diffBalances(projected, [])[0]?.actual).toEqual({ onHand: 0, allocated: 0 });
  });
});
