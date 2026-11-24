import type { AllocationDetail } from '../../api/types';

export function AllocationDetailView({
  allocation,
  onRelease,
}: {
  allocation: AllocationDetail;
  onRelease: () => void;
}) {
  return (
    <section className="card" aria-label={`Allocation ${allocation.orderRef}`}>
      <header className="row between">
        <h2>
          {allocation.orderRef}{' '}
          <span className={`status status-${allocation.status.toLowerCase()}`}>
            {allocation.status}
          </span>
        </h2>
        {allocation.status !== 'RELEASED' && (
          <button type="button" className="secondary" onClick={onRelease}>
            Release
          </button>
        )}
      </header>
      {allocation.lines.map((line) => (
        <div key={line.lineNo} className="line">
          <p>
            Line {line.lineNo}: <strong>{line.skuCode}</strong> — {line.allocated} of{' '}
            {line.requested} allocated ({line.strategy})
          </p>
          <table className="table compact">
            <thead>
              <tr>
                <th scope="col">Bin</th>
                <th scope="col">Lot</th>
                <th scope="col">Expiry</th>
                <th scope="col" className="num">
                  Qty
                </th>
              </tr>
            </thead>
            <tbody>
              {line.picks.map((pick) => (
                <tr key={`${pick.binCode}-${pick.lotCode}`}>
                  <td>
                    <code>{pick.binCode}</code>
                  </td>
                  <td>{pick.lotCode}</td>
                  <td>{pick.expiryDate ?? '—'}</td>
                  <td className="num">{pick.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
