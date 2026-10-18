import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useSession } from '../lib/session';
import { useNotifications } from '../lib/notifications';
import { IdleWarning } from './IdleWarning';

export function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      Demo - fictional data only. Not an emergency service. Do not enter real personal information.
    </div>
  );
}

/** Moves focus to the main region on route change so screen readers announce the new page. */
function useRouteFocus() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname]);
  return mainRef;
}

function Nav() {
  const { session } = useSession();
  const links: [string, string][] = [];
  if (!session) {
    links.push(['/', 'Home'], ['/shelters', 'Shelters'], ['/help', 'Help and limits'], ['/signin', 'Sign in'], ['/signup', 'Create account']);
  } else {
    if (session.person) links.push(['/dashboard', 'Dashboard'], ['/requests/incoming', 'Requests for you'], ['/requests/outgoing', 'Your requests'], ['/sharing', 'Sharing']);
    if (session.staff) links.push(['/staff', 'Staff work']);
    links.push(['/account', 'Account'], ['/help', 'Help']);
  }
  return (
    <nav className="site-nav" aria-label="Main">
      <ul>
        {links.map(([to, label]) => (
          <li key={to}>
            <NavLink to={to} end={to === '/'}>
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function UpdatesLink() {
  const n = useNotifications();
  const unread = n.data?.unread ?? 0;
  return (
    <NavLink to="/notifications" aria-label={unread ? `Updates, ${unread} new` : 'Updates'}>
      Updates{unread ? ` (${unread} new)` : ''}
    </NavLink>
  );
}

function HeaderActions() {
  const { session, signOut } = useSession();
  if (!session) return null;
  return (
    <div className="header-actions">
      {session.person && <UpdatesLink />}
      <span className="context-chip">
        Signed in as <strong>{session.account.username}</strong>
        {session.staff ? ' (staff)' : ''}
      </span>
      <button type="button" className="secondary" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

export function Layout() {
  const mainRef = useRouteFocus();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <DemoBanner />
      <header className="site-header">
        <div className="inner">
          <NavLink to="/" className="brand">
            Reconnect <small>demo</small>
          </NavLink>
          <Nav />
          <HeaderActions />
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1}>
        <IdleWarning />
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="inner">
          Challenge prototype using fictional people and shelters. It cannot locate anyone, does not track devices, and is
          not monitored for emergencies.
        </div>
      </footer>
    </>
  );
}
