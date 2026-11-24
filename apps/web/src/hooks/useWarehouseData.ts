import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { Bin, Sku, Warehouse } from '../api/types';

/** Loads warehouses, then bins + SKUs for the selected warehouse. */
export function useWarehouseData() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [bins, setBins] = useState<Bin[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Warehouse[]>('/api/v1/warehouses')
      .then((list) => {
        setWarehouses(list);
        setWarehouseId((current) => current || list[0]?.id || '');
      })
      .catch((err: unknown) => setError(errorMessage(err)));
    api
      .get<Sku[]>('/api/v1/skus')
      .then(setSkus)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    if (!warehouseId) return;
    api
      .get<Bin[]>(`/api/v1/warehouses/${warehouseId}/bins`)
      .then(setBins)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [warehouseId]);

  const selectWarehouse = useCallback((id: string) => setWarehouseId(id), []);

  return { warehouses, warehouseId, selectWarehouse, bins, skus, error };
}
