import { ALLOCATION_STRATEGIES, type AllocationStrategy } from '@stockpilot/shared';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api/client';
import type { AllocationDetail, Sku } from '../../api/types';
import { UomSelect } from '../stock/UomSelect';

interface Props {
  readonly warehouseId: string;
  readonly skus: readonly Sku[];
  readonly onAllocated: (allocation: AllocationDetail) => void;
}

export function AllocationForm({ warehouseId, skus, onAllocated }: Props) {
  const [orderRef, setOrderRef] = useState('');
  const [skuId, setSkuId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [uom, setUom] = useState('');
  const [strategy, setStrategy] = useState<'' | AllocationStrategy>('');
  const [shipComplete, setShipComplete] = useState(false);
  const [minShelfLifeDays, setMinShelfLifeDays] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sku = skus.find((s) => s.id === skuId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const allocation = await api.post<AllocationDetail>('/api/v1/allocations', {
        warehouseId,
        orderRef,
        shipComplete,
        ...(strategy ? { strategy } : {}),
        ...(minShelfLifeDays ? { minShelfLifeDays: Number(minShelfLifeDays) } : {}),
        lines: [{ skuId, quantity: Number(quantity), uom: uom || sku?.baseUom }],
      });
      onAllocated(allocation);
      setOrderRef('');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form className="card form" onSubmit={(e) => void submit(e)} aria-label="Allocate order">
      <h2>Allocate an order line</h2>
      <label>
        Order reference
        <input
          value={orderRef}
          onChange={(e) => setOrderRef(e.target.value)}
          required
          maxLength={64}
        />
      </label>
      <label>
        SKU
        <select
          value={skuId}
          onChange={(e) => {
            setSkuId(e.target.value);
            setUom('');
          }}
          required
        >
          <option value="">Select SKU…</option>
          {skus.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} ({s.defaultStrategy})
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <label>
          Quantity
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </label>
        <UomSelect sku={sku} value={uom || sku?.baseUom || ''} onChange={setUom} />
      </div>
      <div className="row">
        <label>
          Strategy
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as '' | AllocationStrategy)}
          >
            <option value="">SKU default</option>
            {ALLOCATION_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Min shelf life (days)
          <input
            type="number"
            min={0}
            value={minShelfLifeDays}
            onChange={(e) => setMinShelfLifeDays(e.target.value)}
          />
        </label>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={shipComplete}
          onChange={(e) => setShipComplete(e.target.checked)}
        />
        Ship complete (all or nothing)
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={!warehouseId}>
        Allocate
      </button>
    </form>
  );
}
