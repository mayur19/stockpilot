import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api/client';
import type { Bin, Sku, StockBalance } from '../../api/types';
import { UomSelect } from './UomSelect';

interface Props {
  readonly warehouseId: string;
  readonly source: StockBalance;
  readonly bins: readonly Bin[];
  readonly sku: Sku | undefined;
  readonly onDone: (message: string) => void;
  readonly onCancel: () => void;
}

export function MoveForm({ warehouseId, source, bins, sku, onDone, onCancel }: Props) {
  const [toBinId, setToBinId] = useState('');
  const [quantity, setQuantity] = useState(String(source.available));
  const [uom, setUom] = useState(source.baseUom);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await api.post('/api/v1/inventory/moves', {
        warehouseId,
        fromBinId: source.binId,
        toBinId,
        skuId: source.skuId,
        lotId: source.lotId,
        quantity: Number(quantity),
        uom,
      });
      const target = bins.find((b) => b.id === toBinId)?.code ?? 'bin';
      onDone(`Moved ${quantity} ${uom} of ${source.skuCode} from ${source.binCode} to ${target}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form className="card form" onSubmit={(e) => void submit(e)} aria-label="Move stock">
      <h2>Move {source.skuCode}</h2>
      <p className="muted">
        From <code>{source.binCode}</code>, lot {source.lotCode} — {source.available}{' '}
        {source.baseUom} available
      </p>
      <label>
        To bin
        <select value={toBinId} onChange={(e) => setToBinId(e.target.value)} required>
          <option value="">Select bin…</option>
          {bins
            .filter((b) => b.id !== source.binId)
            .map((b) => (
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
        <UomSelect sku={sku} value={uom} onChange={setUom} />
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit">Move</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
