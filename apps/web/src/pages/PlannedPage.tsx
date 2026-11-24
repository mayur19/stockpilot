import { useParams } from 'react-router-dom';
import { findPlanned } from '../routes/navigation';

export function PlannedPage() {
  const { slug = '' } = useParams();
  const item = findPlanned(slug);
  return (
    <section className="card">
      <h1>
        {item?.label ?? 'Planned feature'} <span className="badge">Planned</span>
      </h1>
      <p>{item?.description ?? 'This area is on the roadmap.'}</p>
      {item?.ticket && (
        <p className="muted">
          Tracked as <code>{item.ticket}</code> in docs/planning/backlog.md.
        </p>
      )}
    </section>
  );
}
