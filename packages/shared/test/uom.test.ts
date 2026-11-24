import { describe, expect, it } from 'vitest';
import {
  breakdownQuantity,
  convertQuantity,
  createUomLadder,
  DomainError,
  factorOf,
  formatBreakdown,
  isValidUomCode,
  toBaseUnits,
} from '../src/index.js';

const ladder = createUomLadder('EA', [
  { code: 'PL', factor: 480 },
  { code: 'CS', factor: 12 },
]);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'OTHER';
  }
  return undefined;
}

describe('createUomLadder', () => {
  it('sorts levels ascending and freezes the result', () => {
    expect(ladder.levels.map((l) => l.code)).toEqual(['CS', 'PL']);
    expect(Object.isFrozen(ladder)).toBe(true);
    expect(Object.isFrozen(ladder.levels)).toBe(true);
  });

  it('accepts a base-only ladder', () => {
    expect(createUomLadder('KG', []).levels).toHaveLength(0);
  });

  it.each([
    ['lowercase base', 'ea', []],
    ['duplicate of base', 'EA', [{ code: 'EA', factor: 6 }]],
    [
      'duplicate level',
      'EA',
      [
        { code: 'CS', factor: 6 },
        { code: 'CS', factor: 12 },
      ],
    ],
    ['factor below two', 'EA', [{ code: 'CS', factor: 1 }]],
    ['fractional factor', 'EA', [{ code: 'CS', factor: 2.5 }]],
    [
      'not nested',
      'EA',
      [
        { code: 'CS', factor: 12 },
        { code: 'PL', factor: 100 },
      ],
    ],
    [
      'equal factors',
      'EA',
      [
        { code: 'CS', factor: 12 },
        { code: 'BX', factor: 12 },
      ],
    ],
    ['bad level code', 'EA', [{ code: '1X', factor: 12 }]],
  ])('rejects %s', (_label, base, levels) => {
    expect(codeOf(() => createUomLadder(base, levels))).toBe('INVALID_UOM_LADDER');
  });
});

describe('conversions', () => {
  it('converts to base units', () => {
    expect(toBaseUnits(ladder, 3, 'CS')).toBe(36);
    expect(toBaseUnits(ladder, 2, 'PL')).toBe(960);
    expect(toBaseUnits(ladder, 7, 'EA')).toBe(7);
  });

  it('looks up factors and rejects unknown units', () => {
    expect(factorOf(ladder, 'EA')).toBe(1);
    expect(factorOf(ladder, 'PL')).toBe(480);
    expect(codeOf(() => factorOf(ladder, 'BX'))).toBe('INVALID_UOM');
  });

  it('converts between pack levels exactly', () => {
    expect(convertQuantity(ladder, 2, 'PL', 'CS')).toBe(80);
    expect(convertQuantity(ladder, 24, 'EA', 'CS')).toBe(2);
    expect(convertQuantity(ladder, 80, 'CS', 'PL')).toBe(2);
  });

  it('refuses to round non-integral conversions', () => {
    expect(codeOf(() => convertQuantity(ladder, 18, 'EA', 'CS'))).toBe('NON_INTEGRAL_CONVERSION');
  });

  it('rejects zero, negative, fractional and overflowing quantities', () => {
    expect(codeOf(() => toBaseUnits(ladder, 0, 'EA'))).toBe('INVALID_QUANTITY');
    expect(codeOf(() => toBaseUnits(ladder, -1, 'EA'))).toBe('INVALID_QUANTITY');
    expect(codeOf(() => toBaseUnits(ladder, 1.5, 'CS'))).toBe('INVALID_QUANTITY');
    expect(codeOf(() => toBaseUnits(ladder, 1e12, 'PL'))).toBe('INVALID_QUANTITY');
  });

  it('round-trips random quantities through every level', () => {
    for (let q = 1; q <= 500; q += 7) {
      for (const uom of ['EA', 'CS', 'PL']) {
        const base = toBaseUnits(ladder, q, uom);
        expect(convertQuantity(ladder, base, 'EA', uom)).toBe(q);
      }
    }
  });
});

describe('breakdownQuantity', () => {
  it('decomposes largest levels first', () => {
    expect(breakdownQuantity(ladder, 1000)).toEqual([
      { uom: 'PL', quantity: 2 },
      { uom: 'CS', quantity: 3 },
      { uom: 'EA', quantity: 4 },
    ]);
    expect(formatBreakdown(breakdownQuantity(ladder, 1000))).toBe('2 PL + 3 CS + 4 EA');
  });

  it('omits empty levels and handles zero', () => {
    expect(breakdownQuantity(ladder, 480)).toEqual([{ uom: 'PL', quantity: 1 }]);
    expect(breakdownQuantity(ladder, 0)).toEqual([{ uom: 'EA', quantity: 0 }]);
  });

  it('always sums back to the original quantity', () => {
    for (let base = 0; base < 2000; base += 13) {
      const total = breakdownQuantity(ladder, base).reduce(
        (sum, part) => sum + part.quantity * factorOf(ladder, part.uom),
        0,
      );
      expect(total).toBe(base);
    }
  });

  it('rejects negative input', () => {
    expect(codeOf(() => breakdownQuantity(ladder, -5))).toBe('INVALID_QUANTITY');
  });

  it('validates unit codes', () => {
    expect(isValidUomCode('CS')).toBe(true);
    expect(isValidUomCode('cs')).toBe(false);
    expect(isValidUomCode('TOOLONGCODE1')).toBe(false);
  });
});
