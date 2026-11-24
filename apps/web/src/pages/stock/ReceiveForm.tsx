import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api/client';
import type { Bin, Sku } from '../../api/types';
import { UomSelect } from './UomSelect';

interface Props {
  readonly warehouseId: string;
  readonly bins: readonly Bin[];
  readonly skus: readonly Sku[];
  readonly onDone: (message: string) => void;
}

export function ReceiveForm({ warehouseId, bins, skus, onDone }: Props) {
  const [skuId, setSkuId] = useState('');
  const [binId, setBinId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [uom, setUom] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sku = skus.find((s) => s.id === skuId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const result = await api.post<{ quantityDescription: string; lot: { lotCode: string } }>(
        '/api/v1/inventory/receipts',
        {
          warehouseId,
          binId,
          skuId,
          quantity: Number(quantity),
          uom: uom || sku?.baseUom,
          ...(sku?.lotTracked ? { lotCode } : {}),
          ...(sku?.expiryTracked ? { expiryDate } : {}),
        },
      );
      onDone(`Received ${result.quantityDescription} of ${sku?.code} (lot ${result.lot.lotCode})`);
      setQuantity('1');
      setLotCode('');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form className="card form" onSubmit={(e) => void submit(e)} aria-label="Receive stock">
      <h2>Receive</h2>
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
              {s.code} — {s.description}
            </option>
          ))}
        </select>
      </label>
      <label>
        Bin
        <select value={binId} onChange={(e) => setBinId(e.target.value)} required>
          <option value="">Select bin…</option>
          {bins.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} ({b.zoneCode})
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
      {sku?.lotTracked && (
        <label>
          Lot code
          <input value={lotCode} onChange={(e) => setLotCode(e.target.value)} required />
        </label>
      )}
      {sku?.expiryTracked && (
        <label>
          Expiry date
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            required
          />
        </label>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={!warehouseId}>
        Receive
      </button>
    </form>
  );
}
