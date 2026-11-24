import { describe, expect, it } from 'vitest';
import {
  addDays,
  addQuantities,
  allocationSchema,
  assertIsoDate,
  createSkuSchema,
  DomainError,
  hasPermission,
  isRole,
  isValidQuantity,
  loginSchema,
  MAX_QUANTITY,
  receiptSchema,
  registerSchema,
  ROLE_PERMISSIONS,
} from '../src/index.js';

const uuid = '0b6f2a7e-3c1d-4b8e-9f0a-1234567890ab';

describe('dates', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => assertIsoDate('2026-13-01')).toThrow(DomainError);
    expect(() => assertIsoDate('2026/01/01')).toThrow(DomainError);
  });
});

describe('quantity helpers', () => {
  it('validates bounds', () => {
    expect(isValidQuantity(1)).toBe(true);
    expect(isValidQuantity(MAX_QUANTITY + 1)).toBe(false);
    expect(addQuantities(2, 3)).toBe(5);
    expect(() => addQuantities(Number.MAX_SAFE_INTEGER, 1)).toThrow(DomainError);
  });
});

describe('roles', () => {
  it('grants a strictly growing set of permissions', () => {
    expect(hasPermission('viewer', 'inventory:read')).toBe(true);
    expect(hasPermission('viewer', 'inventory:receive')).toBe(false);
    expect(hasPermission('operator', 'inventory:move')).toBe(true);
    expect(hasPermission('operator', 'allocation:write')).toBe(false);
    expect(hasPermission('manager', 'allocation:write')).toBe(true);
    expect(hasPermission('manager', 'topology:write')).toBe(false);
    expect(hasPermission('owner', 'users:manage')).toBe(true);
    for (const permission of ROLE_PERMISSIONS.viewer) {
      expect(hasPermission('operator', permission)).toBe(true);
    }
    expect(isRole('owner')).toBe(true);
    expect(isRole('root')).toBe(false);
  });
});

describe('schemas', () => {
  it('normalises auth input', () => {
    expect(loginSchema.parse({ email: ' Ops@Example.COM ', password: 'x' }).email).toBe(
      'ops@example.com',
    );
    expect(
      registerSchema.safeParse({
        organizationName: 'Acme',
        name: 'A',
        email: 'a@b.co',
        password: 'short',
      }).success,
    ).toBe(false);
  });

  it('defaults SKU options and upper-cases codes', () => {
    const sku = createSkuSchema.parse({ code: 'milk-1l', description: 'Milk 1L' });
    expect(sku).toMatchObject({
      code: 'MILK-1L',
      baseUom: 'EA',
      lotTracked: false,
      defaultStrategy: 'FIFO',
    });
  });

  it('rejects fractional receipt quantities and bad dates', () => {
    const base = { warehouseId: uuid, binId: uuid, skuId: uuid };
    expect(receiptSchema.safeParse({ ...base, quantity: 1.5 }).success).toBe(false);
    expect(
      receiptSchema.safeParse({ ...base, quantity: 1, expiryDate: '01-01-2026' }).success,
    ).toBe(false);
    expect(receiptSchema.parse({ ...base, quantity: 3, uom: 'cs' }).uom).toBe('CS');
  });

  it('requires at least one allocation line', () => {
    expect(
      allocationSchema.safeParse({ warehouseId: uuid, orderRef: 'SO-1', lines: [] }).success,
    ).toBe(false);
    expect(
      allocationSchema.parse({
        warehouseId: uuid,
        orderRef: 'SO-1',
        lines: [{ skuId: uuid, quantity: 2 }],
      }).shipComplete,
    ).toBe(false);
  });
});
