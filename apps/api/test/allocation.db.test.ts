import { describe, expect, it } from 'vitest';
import {
  buildWarehouse,
  client,
  createSku,
  hasDatabase,
  isoDaysFromToday,
  registerOrg,
  useTestServer,
  type Client,
} from './helpers.js';

describe.skipIf(!hasDatabase)('allocation engine (database)', () => {
  const server = useTestServer();

  async function stocked() {
    const owner = await registerOrg(server.app, 'alloc');
    const api = client(server.app, owner);
    const { warehouse, bins } = await buildWarehouse(api);
    const sku = await createSku(api);
    const receive = (binId: string, quantity: number, lotCode: string, expiryInDays: number) =>
      api.post('/api/v1/inventory/receipts', {
        warehouseId: warehouse.id,
        binId,
        skuId: sku.id,
        quantity,
        lotCode,
        expiryDate: isoDaysFromToday(expiryInDays),
      });
    await receive(bins.a1.id, 24, 'LATE', 90);
    await receive(bins.a2.id, 10, 'SOON', 20);
    await receive(bins.p1.id, 5, 'SOONEST', 3);
    await receive(bins.q.id, 50, 'QUAR', 10);
    await receive(bins.rcv.id, 50, 'DOCK', 15);
    return { owner, api, warehouse, bins, sku };
  }

  const allocate = (api: Client, warehouseId: string, body: Record<string, unknown>) =>
    api.post('/api/v1/allocations', {
      warehouseId,
      orderRef: `SO-${Math.random().toString(36).slice(2, 8)}`,
      ...body,
    });

  it('allocates FEFO from storage and pick zones only, honouring shelf life', async () => {
    const { api, warehouse, sku } = await stocked();
    const response = await allocate(api, warehouse.id, {
      minShelfLifeDays: 7,
      lines: [{ skuId: sku.id, quantity: 12 }],
    });
    expect(response.statusCode).toBe(201);
    const allocation = response.json().data;
    expect(allocation.status).toBe('ALLOCATED');
    // Picks are returned in walk (pick-sequence) order; FEFO decided which lots.
    const picks = allocation.lines[0].picks.map((p: { lotCode: string; quantity: number }) => [
      p.lotCode,
      p.quantity,
    ]);
    expect(picks).toEqual([
      ['LATE', 2],
      ['SOON', 10],
    ]);
    const balances = (
      await api.get(`/api/v1/inventory/balances?warehouseId=${warehouse.id}&skuId=${sku.id}`)
    ).json().data;
    const soon = balances.find((b: { lotCode: string }) => b.lotCode === 'SOON');
    expect(soon).toMatchObject({ onHand: 10, allocated: 10, available: 0 });
  });

  it('respects an explicit FIFO override and pack-unit quantities', async () => {
    const { api, warehouse, sku } = await stocked();
    const allocation = (
      await allocate(api, warehouse.id, {
        strategy: 'FIFO',
        lines: [{ skuId: sku.id, quantity: 2, uom: 'CS' }],
      })
    ).json().data;
    expect(allocation.lines[0]).toMatchObject({ strategy: 'FIFO', requested: 24, allocated: 24 });
    expect(allocation.lines[0].picks[0].lotCode).toBe('LATE');
  });

  it('allocates partially when allowed and rejects ship-complete shortfalls', async () => {
    const { api, warehouse, sku } = await stocked();
    const partial = (
      await allocate(api, warehouse.id, { lines: [{ skuId: sku.id, quantity: 100 }] })
    ).json().data;
    expect(partial.status).toBe('PARTIAL');
    expect(partial.lines[0]).toMatchObject({ requested: 100, allocated: 39 });
    const rejected = await allocate(api, warehouse.id, {
      shipComplete: true,
      lines: [{ skuId: sku.id, quantity: 1 }],
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(rejected.json().error.details.lines[0]).toMatchObject({ requested: 1, shortfall: 1 });
  });

  it('rejects duplicate open order references and unknown SKUs', async () => {
    const { api, warehouse, sku } = await stocked();
    const body = { orderRef: 'SO-DUP', lines: [{ skuId: sku.id, quantity: 1 }] };
    expect((await allocate(api, warehouse.id, body)).statusCode).toBe(201);
    expect((await allocate(api, warehouse.id, body)).statusCode).toBe(409);
    const unknown = await allocate(api, warehouse.id, {
      lines: [{ skuId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('releases an allocation back to available exactly once', async () => {
    const { api, warehouse, sku } = await stocked();
    const allocation = (
      await allocate(api, warehouse.id, { lines: [{ skuId: sku.id, quantity: 30 }] })
    ).json().data;
    const released = await api.post(`/api/v1/allocations/${allocation.id}/release`);
    expect(released.statusCode).toBe(200);
    expect(released.json().data.status).toBe('RELEASED');
    expect((await api.post(`/api/v1/allocations/${allocation.id}/release`)).json().error.code).toBe(
      'ALREADY_RELEASED',
    );
    const balances = (
      await api.get(`/api/v1/inventory/balances?warehouseId=${warehouse.id}&skuId=${sku.id}`)
    ).json().data;
    expect(balances.every((b: { allocated: number }) => b.allocated === 0)).toBe(true);
    const list = (await api.get(`/api/v1/allocations?warehouseId=${warehouse.id}`)).json().data;
    expect(list[0].id).toBe(allocation.id);
    expect(
      (await api.get(`/api/v1/allocations/${allocation.id}`)).json().data.lines[0].picks.length,
    ).toBeGreaterThan(0);
  });

  it('prevents moving allocated units out of a bin', async () => {
    const { api, warehouse, bins, sku } = await stocked();
    // SOONEST (5) then SOON (10) are consumed first under FEFO.
    await allocate(api, warehouse.id, { lines: [{ skuId: sku.id, quantity: 15 }] });
    const lots = (await api.get(`/api/v1/skus/${sku.id}/lots`)).json().data;
    const soon = lots.find((l: { lotCode: string }) => l.lotCode === 'SOON');
    const move = await api.post('/api/v1/inventory/moves', {
      warehouseId: warehouse.id,
      fromBinId: bins.a2.id,
      toBinId: bins.a3.id,
      skuId: sku.id,
      lotId: soon.id,
      quantity: 1,
    });
    expect(move.statusCode).toBe(409);
  });

  it('never oversells under concurrent allocation', async () => {
    const { api, warehouse, sku } = await stocked();
    // 39 allocatable units (24 LATE + 10 SOON + 5 SOONEST); 12 orders of 5 race for them.
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        api.post('/api/v1/allocations', {
          warehouseId: warehouse.id,
          orderRef: `RACE-${i}`,
          shipComplete: true,
          lines: [{ skuId: sku.id, quantity: 5 }],
        }),
      ),
    );
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 201)).toHaveLength(7);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    const balances = (
      await api.get(`/api/v1/inventory/balances?warehouseId=${warehouse.id}&skuId=${sku.id}`)
    ).json().data;
    const allocated = balances.reduce(
      (sum: number, b: { allocated: number }) => sum + b.allocated,
      0,
    );
    expect(allocated).toBe(35);
    for (const b of balances) expect(b.allocated).toBeLessThanOrEqual(b.onHand);
    const verify = (await api.get('/api/v1/inventory/projection/verify')).json().data;
    expect(verify.consistent).toBe(true);
  });

  it('keeps the projection consistent with the ledger after mixed operations', async () => {
    const { api, warehouse, sku } = await stocked();
    const a = (
      await allocate(api, warehouse.id, { lines: [{ skuId: sku.id, quantity: 7 }] })
    ).json().data;
    await allocate(api, warehouse.id, { lines: [{ skuId: sku.id, quantity: 4 }] });
    await api.post(`/api/v1/allocations/${a.id}/release`);
    const verify = (await api.get('/api/v1/inventory/projection/verify')).json().data;
    expect(verify).toMatchObject({ consistent: true });
    expect(verify.movementCount).toBeGreaterThan(5);
  });
});
