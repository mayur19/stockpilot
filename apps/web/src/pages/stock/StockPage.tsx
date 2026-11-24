import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { StockBalance } from '../../api/types';
import { useWarehouseData } from '../../hooks/useWarehouseData';
import { BalanceTable } from './BalanceTable';
import { MoveForm } from './MoveForm';
import { ReceiveForm } from './ReceiveForm';

export function StockPage() {
  const {
    warehouses,
    warehouseId,
    selectWarehouse,
    bins,
    skus,
    error: loadError,
  } = useWarehouseData();
  const [skuFilter, setSkuFilter] = useState('');
  const [binFilter, setBinFilter] = useState('');
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [moving, setMoving] = useState<StockBalance | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s] as const)), [skus]);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    const params = new URLSearchParams({ warehouseId, limit: '200' });
    if (skuFilter) params.set('skuId', skuFilter);
    if (binFilter) params.set('binId', binFilter);
    try {
      setBalances(await api.get<StockBalance[]>(`/api/v1/inventory/balances?${params.toString()}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [warehouseId, skuFilter, binFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = (message: string) => {
    setNotice(message);
    setMoving(null);
    void load();
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Stock on hand</h1>
        <div className="filters">
          <label>
            Warehouse
            <select value={warehouseId} onChange={(e) => selectWarehouse(e.target.value)}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            SKU
            <select value={skuFilter} onChange={(e) => setSkuFilter(e.target.value)}>
              <option value="">All SKUs</option>
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bin
            <select value={binFilter} onChange={(e) => setBinFilter(e.target.value)}>
              <option value="">All bins</option>
              {bins.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {(error ?? loadError) && (
        <p className="error" role="alert">
          {error ?? loadError}
        </p>
      )}
      <div className="split">
        <section className="card grow">
          <BalanceTable balances={balances} skus={skuMap} onMove={setMoving} />
        </section>
        <div className="side">
          {moving ? (
            <MoveForm
              key={`${moving.binId}-${moving.lotId}`}
              warehouseId={warehouseId}
              source={moving}
              bins={bins}
              sku={skuMap.get(moving.skuId)}
              onDone={done}
              onCancel={() => setMoving(null)}
            />
          ) : (
            <ReceiveForm warehouseId={warehouseId} bins={bins} skus={skus} onDone={done} />
          )}
        </div>
      </div>
    </div>
  );
}
