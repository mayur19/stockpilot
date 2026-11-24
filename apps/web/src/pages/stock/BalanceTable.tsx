import type { Sku, StockBalance } from '../../api/types';
import { daysUntil, describeQuantity } from '../../format';

interface Props {
  readonly balances: readonly StockBalance[];
  readonly skus: ReadonlyMap<string, Sku>;
  readonly onMove?: (balance: StockBalance) => void;
  readonly today?: Date;
}

function ExpiryCell({ date, today }: { date: string | null; today: Date | undefined }) {
  if (!date) return <span className="muted">—</span>;
  const days = daysUntil(date, today);
  const tone = days <= 0 ? 'danger' : days <= 14 ? 'warn' : '';
  return (
    <span className={tone} title={`${days} days`}>
      {date}
    </span>
  );
}

export function BalanceTable({ balances, skus, onMove, today }: Props) {
  if (balances.length === 0) {
    return <p className="muted">No stock matches the current filters.</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">Bin</th>
          <th scope="col">Zone</th>
          <th scope="col">SKU</th>
          <th scope="col">Lot</th>
          <th scope="col">Expiry</th>
          <th scope="col" className="num">
            On hand
          </th>
          <th scope="col" className="num">
            Allocated
          </th>
          <th scope="col" className="num">
            Available
          </th>
          {onMove && (
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {balances.map((b) => {
          const sku = skus.get(b.skuId);
          return (
            <tr key={`${b.binId}-${b.lotId}-${b.skuId}`}>
              <td>
                <code>{b.binCode}</code>
              </td>
              <td>{b.zoneCode}</td>
              <td title={b.skuDescription}>{b.skuCode}</td>
              <td>{b.lotCode}</td>
              <td>
                <ExpiryCell date={b.expiryDate} today={today} />
              </td>
              <td className="num" title={describeQuantity(b.onHand, sku)}>
                {b.onHand}
              </td>
              <td className="num">{b.allocated}</td>
              <td className="num">
                <strong>{b.available}</strong>
                <div className="muted small">{describeQuantity(b.available, sku)}</div>
              </td>
              {onMove && (
                <td>
                  <button
                    type="button"
                    className="link"
                    disabled={b.available === 0}
                    onClick={() => onMove(b)}
                  >
                    Move
                  </button>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
