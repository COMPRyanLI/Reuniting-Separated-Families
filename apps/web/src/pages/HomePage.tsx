import { Link } from 'react-router';
import { useSession } from '../lib/session';
import { usePageTitle } from '../components/PageTitle';

export function HomePage() {
  usePageTitle('Home');
  const { session } = useSession();
  return (
    <div className="stack">
      <h1>Reconnect with family after the hurricane, privately</h1>
      <p className="lead">
        Leave a historical check-in, send a private request to someone you are looking for, and decide yourself what
        anyone else may see. Shelter staff can help if you have no phone or ID.
      </p>
      {session ? (
        <p>
          <Link className="button" to={session.person ? '/dashboard' : '/staff'}>
            Go to your {session.person ? 'dashboard' : 'staff work'}
          </Link>
        </p>
      ) : (
        <div className="row">
          <Link className="button" to="/signup">
            Create an account
          </Link>
          <Link className="button secondary" to="/signin">
            Sign in
          </Link>
        </div>
      )}
      <div className="grid">
        <div className="card">
          <h2>No public list of people</h2>
          <p>Nobody can browse or search who is here. Requests are private, and you decide whether and what to answer.</p>
        </div>
        <div className="card">
          <h2>History, not tracking</h2>
          <p>A check-in says where you were at a stated time. It never shows where you are now. No GPS is used.</p>
        </div>
        <div className="card">
          <h2>No phone or ID needed</h2>
          <p>Shelter staff can help you check in and answer requests. You keep a private secret for later visits.</p>
        </div>
      </div>
      <p>
        <Link to="/help">Read how privacy works and what this demo cannot do</Link>
      </p>
    </div>
  );
}
