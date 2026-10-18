import { Link } from 'react-router';
import { useSession } from '../lib/session';
import { usePageTitle } from '../components/PageTitle';

export function DashboardPage() {
  usePageTitle('Your dashboard');
  const { session } = useSession();
  return (
    <div className="stack">
      <h1>Hello, {session?.person?.alias}</h1>
      <p className="muted">Signed in as {session?.account.username}. Only you can see this page.</p>
      <div className="grid">
        <Link className="action-tile" to="/check-ins">
          <strong>Let someone know</strong>
          Add a check-in: where you were, and when. Nobody sees it unless you share it.
        </Link>
        <Link className="action-tile" to="/requests/new">
          <strong>Find someone</strong>
          Send a private request with a contact code, or ask one shelter’s team for help.
        </Link>
        <Link className="action-tile" to="/requests/incoming">
          <strong>Review requests</strong>
          See who asked about you and decide what, if anything, to share.
        </Link>
        <Link className="action-tile" to="/sharing">
          <strong>Manage sharing</strong>
          See and revoke what you shared.
        </Link>
        <Link className="action-tile" to="/requests/outgoing">
          <strong>Your requests</strong>
          Status of requests you sent, and answers shared with you.
        </Link>
        <Link className="action-tile" to="/privacy">
          <strong>Privacy and contact code</strong>
          Choose who may send you requests, and get a code to give to family.
        </Link>
      </div>
    </div>
  );
}
