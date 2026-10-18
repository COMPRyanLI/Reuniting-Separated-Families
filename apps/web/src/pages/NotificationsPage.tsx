import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useNotifications } from '../lib/notifications';
import { Loading } from '../components/guards';
import { usePageTitle } from '../components/PageTitle';

export function NotificationsPage() {
  usePageTitle('Updates');
  const qc = useQueryClient();
  const n = useNotifications();
  const read = useMutation({ mutationFn: (id: string) => api('POST', `/notifications/${id}/read`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return (
    <div className="stack">
      <h1>Updates</h1>
      <p className="muted">Updates never contain messages or places. Open the linked page to see what you are allowed to see.</p>
      {n.isPending && <Loading />}
      {n.isError && <p role="alert">Could not load updates. We will try again shortly.</p>}
      {n.data?.notifications.length === 0 && <p>No updates.</p>}
      <ul className="plain">
        {n.data?.notifications.map((x) => (
          <li key={x.id} className="card">
            <p className="row">
              {!x.read && <span className="badge badge-warn">New</span>}
              <span>{x.text}</span>
            </p>
            <p className="small muted">{new Date(x.createdAt).toLocaleString()}</p>
            <div className="row">
              <Link to={x.link} onClick={() => !x.read && read.mutate(x.id)}>
                Open
              </Link>
              {!x.read && (
                <button type="button" className="link" onClick={() => read.mutate(x.id)}>
                  Mark as read
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
