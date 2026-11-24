import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { AllocationDetail, AllocationSummary } from '../../api/types';
import { useWarehouseData } from '../../hooks/useWarehouseData';
import { AllocationDetailView } from './AllocationDetailView';
import { AllocationForm } from './AllocationForm';

export function AllocationsPage() {
  const { warehouses, warehouseId, selectWarehouse, skus } = useWarehouseData();
  const [list, setList] = useState<AllocationSummary[]>([]);
  const [selected, setSelected] = useState<AllocationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      setList(await api.get<AllocationSummary[]>(`/api/v1/allocations?warehouseId=${warehouseId}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (id: string) => {
    try {
      setSelected(await api.get<AllocationDetail>(`/api/v1/allocations/${id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const release = async () => {
    if (!selected) return;
    try {
      setSelected(await api.post<AllocationDetail>(`/api/v1/allocations/${selected.id}/release`));
      void load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Allocations</h1>
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
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="split">
        <div className="grow stack">
          {selected && (
            <AllocationDetailView allocation={selected} onRelease={() => void release()} />
          )}
          <section className="card">
            <h2>Recent allocations</h2>
            <ul className="list">
              {list.map((a) => (
                <li key={a.id}>
                  <button type="button" className="link" onClick={() => void open(a.id)}>
                    {a.orderRef}
                  </button>
                  <span className={`status status-${a.status.toLowerCase()}`}>{a.status}</span>
                  <span className="muted small">{new Date(a.createdAt).toLocaleString()}</span>
                </li>
              ))}
              {list.length === 0 && <li className="muted">No allocations yet.</li>}
            </ul>
          </section>
        </div>
        <div className="side">
          <AllocationForm
            warehouseId={warehouseId}
            skus={skus}
            onAllocated={(a) => {
              setSelected(a);
              void load();
            }}
          />
        </div>
      </div>
    </div>
  );
}
