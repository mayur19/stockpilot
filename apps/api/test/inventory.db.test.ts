import { describe, expect, it } from 'vitest';
import {
  addUser,
  buildWarehouse,
  client,
  createSku,
  hasDatabase,
  isoDaysFromToday,
  registerOrg,
  useTestServer,
} from './helpers.js';

describe.skipIf(!hasDatabase)('topology, catalogue and inventory ledger (database)', () => {
  const server = useTestServer();

  async function setup() {
    const owner = await registerOrg(server.app, 'inv');
    const api = client(server.app, owner);
    const wh = await buildWarehouse(api);
    return { owner, api, ...wh };
  }

  it('validates bin codes and derives a serpentine pick sequence', async () => {
    const { api, warehouse, bins } = await setup();
    expect(bins.a1.code).toBe('A-01-01-1-A');
    expect(bins.a2.pickSequence).toBeGreaterThan(bins.a1.pickSequence);
    const zones = (await api.get(`/api/v1/warehouses/${warehouse.id}/zones`)).json().data;
    const bad = await api.post(`/api/v1/warehouses/${warehouse.id}/bins`, {
      zoneId: zones[0].id,
      code: 'A-00-01-1-A',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_BIN_CODE');
    const dup = await api.post(`/api/v1/warehouses/${warehouse.id}/bins`, {
      zoneId: zones[0].id,
      code: 'a-01-01-1-a',
    });
    expect(dup.statusCode).toBe(409);
    const list = (await api.get(`/api/v1/warehouses/${warehouse.id}/bins`)).json().data;
    expect(list).toHaveLength(6);
  });

  it('rejects unknown time zones and isolates organisations', async () => {
    const { api, warehouse } = await setup();
    expect(
      (await api.post('/api/v1/warehouses', { code: 'TZ', name: 'TZ', timezone: 'Mars/Olympus' }))
        .statusCode,
    ).toBe(400);
    const canonical = await api.post('/api/v1/warehouses', {
      code: 'TZC',
      name: 'TZ',
      timezone: 'europe/london',
    });
    expect(canonical.json().data.timezone).toBe('Europe/London');
    const other = client(server.app, await registerOrg(server.app, 'other'));
    expect((await other.get(`/api/v1/warehouses/${warehouse.id}`)).statusCode).toBe(404);
    expect((await other.get('/api/v1/warehouses')).json().data).toEqual([]);
  });

  it('validates UoM ladders when creating SKUs', async () => {
    const { api } = await setup();
    const bad = await api.post('/api/v1/skus', {
      code: 'BAD',
      description: 'x',
      uomLevels: [
        { code: 'CS', factor: 12 },
        { code: 'PL', factor: 100 },
      ],
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_UOM_LADDER');
    const expiryOnly = await api.post('/api/v1/skus', {
      code: 'EXP',
      description: 'x',
      expiryTracked: true,
    });
    expect(expiryOnly.statusCode).toBe(400);
    const sku = await createSku(api);
    expect(sku.uomLevels).toEqual([
      { code: 'CS', factor: 12 },
      { code: 'PL', factor: 480 },
    ]);
    expect((await api.get(`/api/v1/skus?search=${sku.code.slice(0, 6)}`)).json().data).toHaveLength(
      1,
    );
  });

  it('receives in pack units, converting to base units and creating the lot', async () => {
    const { api, warehouse, bins } = await setup();
    const sku = await createSku(api);
    const response = await api.post('/api/v1/inventory/receipts', {
      warehouseId: warehouse.id,
      binId: bins.a1.id,
      skuId: sku.id,
      quantity: 3,
      uom: 'CS',
      lotCode: 'l-1',
      expiryDate: isoDaysFromToday(30),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body).toMatchObject({
      quantity: 36,
      quantityDescription: '3 CS',
      lot: { lotCode: 'L-1' },
    });
    expect(body.balance).toMatchObject({ onHand: 36, allocated: 0 });
    const lots = (await api.get(`/api/v1/skus/${sku.id}/lots`)).json().data;
    expect(lots).toHaveLength(1);
  });

  it('enforces lot and expiry rules on receipt', async () => {
    const { api, warehouse, bins } = await setup();
    const sku = await createSku(api);
    const base = { warehouseId: warehouse.id, binId: bins.a1.id, skuId: sku.id, quantity: 1 };
    expect((await api.post('/api/v1/inventory/receipts', base)).statusCode).toBe(400);
    expect(
      (await api.post('/api/v1/inventory/receipts', { ...base, lotCode: 'X' })).statusCode,
    ).toBe(400);
    expect(
      (
        await api.post('/api/v1/inventory/receipts', {
          ...base,
          lotCode: 'X',
          expiryDate: '2026-02-30',
        })
      ).statusCode,
    ).toBe(400);
    await api.post('/api/v1/inventory/receipts', {
      ...base,
      lotCode: 'X',
      expiryDate: isoDaysFromToday(10),
    });
    const mismatch = await api.post('/api/v1/inventory/receipts', {
      ...base,
      lotCode: 'X',
      expiryDate: isoDaysFromToday(11),
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe('LOT_EXPIRY_MISMATCH');
    expect(
      (
        await api.post('/api/v1/inventory/receipts', {
          ...base,
          lotCode: 'X',
          expiryDate: isoDaysFromToday(10),
          uom: 'BX',
        })
      ).json().error.code,
    ).toBe('INVALID_UOM');

    const plain = await createSku(api, { lotTracked: false, expiryTracked: false });
    const auto = await api.post('/api/v1/inventory/receipts', { ...base, skuId: plain.id });
    expect(auto.json().data.lot.lotCode).toMatch(/^AUTO-\d{8}$/);
    expect(
      (await api.post('/api/v1/inventory/receipts', { ...base, skuId: plain.id, lotCode: 'NOPE' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await api.post('/api/v1/inventory/receipts', {
          ...base,
          skuId: plain.id,
          expiryDate: isoDaysFromToday(3),
        })
      ).statusCode,
    ).toBe(400);
  });

  it('moves stock between bins and refuses to move more than is available', async () => {
    const { api, warehouse, bins } = await setup();
    const sku = await createSku(api);
    const receipt = (
      await api.post('/api/v1/inventory/receipts', {
        warehouseId: warehouse.id,
        binId: bins.rcv.id,
        skuId: sku.id,
        quantity: 2,
        uom: 'CS',
        lotCode: 'M1',
        expiryDate: isoDaysFromToday(40),
      })
    ).json().data;
    const move = {
      warehouseId: warehouse.id,
      fromBinId: bins.rcv.id,
      toBinId: bins.a1.id,
      skuId: sku.id,
      lotId: receipt.lot.id,
    };
    const ok = await api.post('/api/v1/inventory/moves', { ...move, quantity: 1, uom: 'CS' });
    expect(ok.statusCode).toBe(201);
    const tooMuch = await api.post('/api/v1/inventory/moves', { ...move, quantity: 13 });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().error.code).toBe('INSUFFICIENT_AVAILABLE');
    expect(
      (await api.post('/api/v1/inventory/moves', { ...move, toBinId: bins.rcv.id, quantity: 1 }))
        .statusCode,
    ).toBe(400);

    const balances = (
      await api.get(`/api/v1/inventory/balances?warehouseId=${warehouse.id}&skuId=${sku.id}`)
    ).json().data;
    expect(balances.map((b: { binCode: string; onHand: number }) => [b.binCode, b.onHand])).toEqual(
      [
        ['RCV01', 12],
        ['A-01-01-1-A', 12],
      ],
    );
  });

  it('adjusts stock with reason codes and blocks negative on-hand', async () => {
    const { api, warehouse, bins } = await setup();
    const sku = await createSku(api, { lotTracked: false, expiryTracked: false });
    const receipt = (
      await api.post('/api/v1/inventory/receipts', {
        warehouseId: warehouse.id,
        binId: bins.a1.id,
        skuId: sku.id,
        quantity: 5,
      })
    ).json().data;
    const adjust = {
      warehouseId: warehouse.id,
      binId: bins.a1.id,
      skuId: sku.id,
      lotId: receipt.lot.id,
      reason: 'DAMAGED',
    };
    expect(
      (await api.post('/api/v1/inventory/adjustments', { ...adjust, delta: -2 })).json().data
        .balance.onHand,
    ).toBe(3);
    expect(
      (
        await api.post('/api/v1/inventory/adjustments', { ...adjust, delta: 4, reason: 'FOUND' })
      ).json().data.balance.onHand,
    ).toBe(7);
    expect(
      (await api.post('/api/v1/inventory/adjustments', { ...adjust, delta: -8 })).statusCode,
    ).toBe(409);
    expect(
      (await api.post('/api/v1/inventory/adjustments', { ...adjust, delta: 0 })).statusCode,
    ).toBe(400);
    const operator = client(
      server.app,
      await addUser(
        server,
        (await api.get('/api/v1/auth/me')).json().data.organization.id,
        'operator',
      ),
    );
    expect(
      (await operator.post('/api/v1/inventory/adjustments', { ...adjust, delta: 1 })).statusCode,
    ).toBe(403);
  });

  it('lists the ledger newest first with keyset pagination', async () => {
    const { api, warehouse, bins } = await setup();
    const sku = await createSku(api, { lotTracked: false, expiryTracked: false });
    for (let i = 0; i < 3; i += 1) {
      await api.post('/api/v1/inventory/receipts', {
        warehouseId: warehouse.id,
        binId: bins.a1.id,
        skuId: sku.id,
        quantity: i + 1,
      });
    }
    const page1 = (
      await api.get(`/api/v1/inventory/movements?warehouseId=${warehouse.id}&limit=2`)
    ).json();
    expect(page1.data.map((m: { quantity: number }) => m.quantity)).toEqual([3, 2]);
    expect(page1.meta.nextCursor).toBeTruthy();
    const page2 = (
      await api.get(
        `/api/v1/inventory/movements?warehouseId=${warehouse.id}&limit=2&before=${page1.meta.nextCursor}`,
      )
    ).json();
    expect(page2.data.map((m: { quantity: number }) => m.quantity)).toEqual([1]);
    expect(page2.meta.nextCursor).toBeNull();
  });

  it('keeps the ledger append-only at the database level', async () => {
    const { api, warehouse, bins } = await setup();
    const sku = await createSku(api, { lotTracked: false, expiryTracked: false });
    const { movementId } = (
      await api.post('/api/v1/inventory/receipts', {
        warehouseId: warehouse.id,
        binId: bins.a1.id,
        skuId: sku.id,
        quantity: 1,
      })
    ).json().data;
    await expect(
      server.db.query('UPDATE inventory_movements SET quantity = 99 WHERE id = $1', [movementId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      server.db.query('DELETE FROM inventory_movements WHERE id = $1', [movementId]),
    ).rejects.toThrow(/append-only/);
  });

  it('verifies the projection against a full ledger replay and detects drift', async () => {
    const { api, owner, warehouse, bins } = await setup();
    const sku = await createSku(api, { lotTracked: false, expiryTracked: false });
    await api.post('/api/v1/inventory/receipts', {
      warehouseId: warehouse.id,
      binId: bins.a1.id,
      skuId: sku.id,
      quantity: 10,
    });
    const clean = (await api.get('/api/v1/inventory/projection/verify')).json().data;
    expect(clean).toMatchObject({ consistent: true, movementCount: 1, mismatches: [] });
    await server.db.query('UPDATE stock_balances SET on_hand = 11 WHERE organization_id = $1', [
      owner.organizationId,
    ]);
    const drifted = (await api.get('/api/v1/inventory/projection/verify')).json().data;
    expect(drifted.consistent).toBe(false);
    expect(drifted.mismatches[0]).toMatchObject({
      expected: { onHand: 10 },
      actual: { onHand: 11 },
    });
  });
});
