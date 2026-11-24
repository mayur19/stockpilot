import { describe, expect, it } from 'vitest';
import {
  compareByStrategy,
  DomainError,
  planAllocation,
  planOrderAllocation,
  type AllocationRequest,
  type StockCandidate,
} from '../src/index.js';

const TODAY = '2026-06-01';

function candidate(overrides: Partial<StockCandidate> & { binId: string }): StockCandidate {
  return {
    binCode: overrides.binId,
    pickSequence: 0,
    lotId: 'L1',
    lotCode: 'L1',
    expiryDate: null,
    receivedAt: '2026-01-01T00:00:00.000Z',
    available: 10,
    ...overrides,
  };
}

function request(overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return { quantity: 10, strategy: 'FEFO', allowPartial: true, today: TODAY, ...overrides };
}

describe('strategy ordering', () => {
  const early = candidate({
    binId: 'A',
    lotId: 'E',
    lotCode: 'E',
    expiryDate: '2026-07-01',
    receivedAt: '2026-03-01T00:00:00Z',
  });
  const late = candidate({
    binId: 'B',
    lotId: 'L',
    lotCode: 'L',
    expiryDate: '2026-09-01',
    receivedAt: '2026-02-01T00:00:00Z',
  });
  const none = candidate({
    binId: 'C',
    lotId: 'N',
    lotCode: 'N',
    expiryDate: null,
    receivedAt: '2026-01-01T00:00:00Z',
  });

  it('FEFO consumes the earliest expiry first and non-perishable lots last', () => {
    const plan = planAllocation(request({ quantity: 25 }), [none, late, early]);
    expect(plan.picks.map((p) => p.lotId)).toEqual(['E', 'L', 'N']);
    expect(plan.picks.map((p) => p.quantity)).toEqual([10, 10, 5]);
  });

  it('FIFO consumes the oldest receipt first regardless of expiry', () => {
    const plan = planAllocation(request({ strategy: 'FIFO', quantity: 15 }), [early, late, none]);
    expect(plan.picks.map((p) => p.lotId)).toEqual(['N', 'L']);
  });

  it('LIFO consumes the newest receipt first', () => {
    const plan = planAllocation(request({ strategy: 'LIFO', quantity: 15 }), [none, late, early]);
    expect(plan.picks.map((p) => p.lotId)).toEqual(['E', 'L']);
  });

  it('FEFO breaks expiry ties by receipt date, then lot code', () => {
    const a = candidate({
      binId: 'A',
      lotId: 'A',
      lotCode: 'A',
      expiryDate: '2026-07-01',
      receivedAt: '2026-02-01T00:00:00Z',
    });
    const b = candidate({
      binId: 'B',
      lotId: 'B',
      lotCode: 'B',
      expiryDate: '2026-07-01',
      receivedAt: '2026-01-01T00:00:00Z',
    });
    const c = { ...b, binId: 'C', lotId: 'C', lotCode: 'C' };
    expect(compareByStrategy('FEFO', a, b)).toBeGreaterThan(0);
    expect(compareByStrategy('FEFO', b, c)).toBeLessThan(0);
    expect(compareByStrategy('FIFO', b, b)).toBe(0);
  });
});

describe('eligibility', () => {
  it('never allocates expired lots, even under FIFO', () => {
    const expired = candidate({ binId: 'A', lotId: 'X', expiryDate: TODAY });
    const good = candidate({
      binId: 'B',
      lotId: 'G',
      expiryDate: '2027-01-01',
      receivedAt: '2026-05-01T00:00:00Z',
    });
    const plan = planAllocation(request({ strategy: 'FIFO', quantity: 5 }), [expired, good]);
    expect(plan.picks.map((p) => p.lotId)).toEqual(['G']);
    expect(plan.excluded).toEqual([{ binId: 'A', lotId: 'X', reason: 'EXPIRED' }]);
  });

  it('enforces minimum remaining shelf life', () => {
    const short = candidate({ binId: 'A', lotId: 'S', expiryDate: '2026-06-20' });
    const long = candidate({ binId: 'B', lotId: 'G', expiryDate: '2026-08-01' });
    const plan = planAllocation(request({ quantity: 5, minShelfLifeDays: 30 }), [short, long]);
    expect(plan.picks.map((p) => p.lotId)).toEqual(['G']);
    expect(plan.excluded[0]?.reason).toBe('SHORT_SHELF_LIFE');
  });

  it('accepts a lot expiring exactly at the shelf-life boundary', () => {
    const edge = candidate({ binId: 'A', lotId: 'E', expiryDate: '2026-07-01' });
    expect(planAllocation(request({ quantity: 1, minShelfLifeDays: 30 }), [edge]).status).toBe(
      'FULL',
    );
  });

  it('skips held and empty rows', () => {
    const plan = planAllocation(request({ quantity: 5 }), [
      candidate({ binId: 'H', onHold: true }),
      candidate({ binId: 'Z', available: 0 }),
      candidate({ binId: 'OK' }),
    ]);
    expect(plan.picks.map((p) => p.binId)).toEqual(['OK']);
    expect(plan.excluded.map((e) => e.reason).sort()).toEqual(['NO_AVAILABLE', 'ON_HOLD']);
  });
});

describe('pick minimisation within a lot', () => {
  it('prefers the smallest single bin that covers the request (best fit)', () => {
    const plan = planAllocation(request({ quantity: 8 }), [
      candidate({ binId: 'BIG', available: 100 }),
      candidate({ binId: 'FIT', available: 9 }),
      candidate({ binId: 'SMALL', available: 3 }),
    ]);
    expect(plan.picks).toHaveLength(1);
    expect(plan.picks[0]?.binId).toBe('FIT');
  });

  it('drains largest bins first when no single bin covers', () => {
    const plan = planAllocation(request({ quantity: 12 }), [
      candidate({ binId: 'A', available: 4 }),
      candidate({ binId: 'B', available: 7 }),
      candidate({ binId: 'C', available: 6 }),
    ]);
    expect(plan.picks.map((p) => [p.binId, p.quantity])).toEqual([
      ['B', 7],
      ['C', 5],
    ]);
  });

  it('breaks quantity ties by pick sequence then bin code', () => {
    const plan = planAllocation(request({ quantity: 5 }), [
      candidate({ binId: 'Z', binCode: 'Z', pickSequence: 2 }),
      candidate({ binId: 'Y', binCode: 'Y', pickSequence: 1 }),
      candidate({ binId: 'X', binCode: 'X', pickSequence: 1 }),
    ]);
    expect(plan.picks[0]?.binId).toBe('X');
  });
});

describe('partial and fill-or-kill', () => {
  const stock = [candidate({ binId: 'A', available: 6 })];

  it('returns PARTIAL with a shortfall when partial is allowed', () => {
    const plan = planAllocation(request({ quantity: 10 }), stock);
    expect(plan).toMatchObject({ status: 'PARTIAL', allocated: 6, shortfall: 4 });
  });

  it('returns NONE with no picks when fill-or-kill cannot be satisfied', () => {
    const plan = planAllocation(request({ quantity: 10, allowPartial: false }), stock);
    expect(plan).toMatchObject({ status: 'NONE', allocated: 0, shortfall: 10, picks: [] });
  });

  it('returns NONE when nothing is eligible', () => {
    expect(planAllocation(request(), []).status).toBe('NONE');
  });

  it('validates the request', () => {
    expect(() => planAllocation(request({ quantity: 0 }), stock)).toThrow(DomainError);
    expect(() => planAllocation(request({ today: '2026-02-30' }), stock)).toThrow(DomainError);
  });
});

describe('planAllocation properties (randomised)', () => {
  let seed = 7;
  const rand = (n: number): number => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };

  it('never over-allocates, never uses excluded rows, and honours FEFO rank', () => {
    for (let trial = 0; trial < 300; trial += 1) {
      const candidates: StockCandidate[] = Array.from({ length: 1 + rand(12) }, (_, i) => {
        const lot = rand(5);
        return candidate({
          binId: `B${i}`,
          pickSequence: rand(50),
          lotId: `L${lot}`,
          lotCode: `L${lot}`,
          expiryDate: lot === 4 ? null : `2026-0${6 + lot}-1${rand(9)}`,
          receivedAt: `2026-01-0${1 + lot}T00:00:00Z`,
          available: rand(20),
          onHold: rand(10) === 0,
        });
      });
      const quantity = 1 + rand(80);
      const plan = planAllocation(request({ quantity, minShelfLifeDays: rand(60) }), candidates);

      const sum = plan.picks.reduce((s, p) => s + p.quantity, 0);
      expect(sum).toBe(plan.allocated);
      expect(plan.allocated + plan.shortfall).toBe(quantity);
      const excludedBins = new Set(plan.excluded.map((e) => e.binId));
      for (const pick of plan.picks) {
        const source = candidates.find((c) => c.binId === pick.binId) as StockCandidate;
        expect(pick.quantity).toBeGreaterThan(0);
        expect(pick.quantity).toBeLessThanOrEqual(source.available);
        expect(excludedBins.has(pick.binId)).toBe(false);
      }
      // FEFO rank: if any eligible stock was left untouched, every pick must rank
      // no later than it.
      const picked = new Set(plan.picks.map((p) => p.binId));
      const untouched = candidates.filter(
        (c) => !picked.has(c.binId) && !excludedBins.has(c.binId),
      );
      if (plan.shortfall === 0) {
        for (const pick of plan.picks) {
          const source = candidates.find((c) => c.binId === pick.binId) as StockCandidate;
          for (const other of untouched) {
            expect(compareByStrategy('FEFO', source, other)).toBeLessThanOrEqual(0);
          }
        }
      } else {
        expect(untouched).toHaveLength(0);
      }
    }
  });
});

describe('planOrderAllocation', () => {
  const pool = {
    S1: [candidate({ binId: 'A', available: 10 })],
    S2: [candidate({ binId: 'B', available: 3 })],
  };

  it('shares a pool between lines of the same SKU', () => {
    const plan = planOrderAllocation(
      {
        lines: [
          { lineId: '1', skuId: 'S1', quantity: 7 },
          { lineId: '2', skuId: 'S1', quantity: 7 },
        ],
        strategyBySku: { S1: 'FIFO' },
        shipComplete: false,
        today: TODAY,
      },
      pool,
    );
    expect(plan.lines.map((l) => l.allocated)).toEqual([7, 3]);
    expect(plan.status).toBe('PARTIAL');
  });

  it('allocates nothing when ship-complete cannot be met', () => {
    const plan = planOrderAllocation(
      {
        lines: [
          { lineId: '1', skuId: 'S1', quantity: 5 },
          { lineId: '2', skuId: 'S2', quantity: 5 },
        ],
        strategyBySku: {},
        shipComplete: true,
        today: TODAY,
        minShelfLifeDays: 0,
      },
      pool,
    );
    expect(plan.status).toBe('NONE');
    expect(plan.lines.every((l) => l.picks.length === 0 && l.allocated === 0)).toBe(true);
  });

  it('reports FULL when every line is covered and NONE for unknown SKUs', () => {
    const full = planOrderAllocation(
      {
        lines: [{ lineId: '1', skuId: 'S1', quantity: 10 }],
        strategyBySku: {},
        shipComplete: true,
        today: TODAY,
      },
      pool,
    );
    expect(full.status).toBe('FULL');
    const none = planOrderAllocation(
      {
        lines: [{ lineId: '1', skuId: 'S9', quantity: 1 }],
        strategyBySku: {},
        shipComplete: false,
        today: TODAY,
      },
      pool,
    );
    expect(none.status).toBe('NONE');
  });
});
