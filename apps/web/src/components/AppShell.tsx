import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { NAVIGATION } from '../routes/navigation';

export function AppShell() {
  const { current, logout } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ▣
          </span>{' '}
          StockPilot
        </div>
        <nav aria-label="Primary">
          {NAVIGATION.map((group) => (
            <div key={group.heading} className="nav-group">
              <h2>{group.heading}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.path}>
                    <NavLink to={item.path}>
                      {item.label}
                      {item.status === 'planned' && <span className="badge">Planned</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>{current?.organization.name}</span>
          <span className="spacer" />
          <span className="muted">
            {current?.user.name} · {current?.user.role}
          </span>
          <button type="button" className="link" onClick={() => void logout()}>
            Sign out
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
