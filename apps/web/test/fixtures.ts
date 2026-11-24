import { vi } from 'vitest';
import type { Bin, Sku, StockBalance } from '../src/api/types';

export const milk: Sku = {
  id: 's1',
  code: 'MILK-UHT-1L',
  description: 'Milk',
  baseUom: 'EA',
  uomLevels: [{ code: 'CS', factor: 12 }],
  lotTracked: true,
  expiryTracked: true,
  defaultStrategy: 'FEFO',
};

export const tee: Sku = {
  ...milk,
  id: 's2',
  code: 'TEE',
  lotTracked: false,
  expiryTracked: false,
  defaultStrategy: 'FIFO',
};

export const bins: Bin[] = [
  { id: 'b1', code: 'A-01-01-1-A', zoneId: 'z1', zoneCode: 'A', pickSequence: 1 },
  { id: 'b2', code: 'A-01-02-1-A', zoneId: 'z1', zoneCode: 'A', pickSequence: 2 },
];

export const balance: StockBalance = {
  binId: 'b1',
  binCode: 'A-01-01-1-A',
  zoneCode: 'A',
  skuId: 's1',
  skuCode: 'MILK-UHT-1L',
  skuDescription: 'Milk',
  baseUom: 'EA',
  lotId: 'l1',
  lotCode: 'M1',
  expiryDate: '2099-01-01',
  onHand: 24,
  allocated: 0,
  available: 24,
};

export const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data, error: null }), { status });
export const fail = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ data: null, error: { code, message } }), { status });

/** Routes fetch calls by "METHOD path-prefix" to canned responses and records bodies. */
export function routeFetch(routes: Record<string, () => Response>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes)
      .filter((k) => {
        const [m, prefix] = k.split(' ');
        return m === method && url.startsWith(prefix as string);
      })
      .sort((a, b) => b.length - a.length)[0];
    if (!key) return fail(404, 'ROUTE_NOT_FOUND', `No mock for ${method} ${url}`);
    return (routes[key] as () => Response)();
  });
  return { spy, calls };
}
