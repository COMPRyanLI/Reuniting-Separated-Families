import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { ErrorSummary, useSubmit } from '../../components/forms';
import { Loading } from '../../components/guards';
import { usePageTitle } from '../../components/PageTitle';

interface Task {
  routeId: string;
  requesterAlias: string;
  clues: string | null;
  requestExpiresAt: string;
}
interface Candidate {
  candidateToken: string;
  alias: string;
  clue: string | null;
}

/**
 * Matching task: compare the requester's clues with people at this shelter who opted in.
 * Proposing someone only delivers the request for their own decision.
 */
export function RouteTaskPage() {
  usePageTitle('Matching task');
  const { routeId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const task = useQuery({ queryKey: ['staff', 'route', routeId], queryFn: () => api<Task>('GET', `/staff/routes/${routeId}`), retry: false });
  const candidates = useQuery({
    queryKey: ['staff', 'route', routeId, 'candidates'],
    queryFn: async () => (await api<{ candidates: Candidate[] }>('GET', `/staff/routes/${routeId}/candidates`)).candidates,
    retry: false,
    enabled: task.isSuccess,
  });
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const propose = useSubmit(() => api('POST', `/staff/routes/${routeId}/propose-recipient`, { candidateToken: chosen!.candidateToken }));
  const noMatch = useSubmit(() => api('POST', `/staff/routes/${routeId}/no-match`, {}));
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['staff'] });
    navigate('/staff', { replace: true });
  };

  if (task.isPending) return <Loading />;
  if (task.isError) {
    return (
      <div className="narrow">
        <h1>Task not available</h1>
        <p>{task.error instanceof ApiError && task.error.status === 404 ? 'This task is finished, reassigned or no longer yours.' : task.error.message}</p>
        <Link to="/staff">Back to staff work</Link>
      </div>
    );
  }
  return (
    <div className="stack">
      <h1>Matching task</h1>
      <div className="card">
        <dl className="kv">
          <dt>Requester’s chosen name</dt>
          <dd>{task.data.requesterAlias}</dd>
          <dt>Clues they shared with your team</dt>
          <dd className="message-text">{task.data.clues ?? '(none)'}</dd>
        </dl>
      </div>
      <p className="muted">
        Only people at your shelter who opted into assisted matching appear, with their chosen name and the clue they volunteered. Ask the person
        before proposing: proposing delivers the request for their own decision, nothing more. The requester is never told.
      </p>
      <ErrorSummary error={propose.error ?? noMatch.error} />
      {candidates.isPending && <Loading />}
      {candidates.data?.length === 0 && <p>Nobody here has opted into assisted matching.</p>}
      <ul className="plain">
        {candidates.data?.map((c) => (
          <li key={c.candidateToken} className="card">
            <p>
              <strong>{c.alias}</strong>
            </p>
            {c.clue && <p className="small">Their clue: {c.clue}</p>}
            {chosen?.candidateToken === c.candidateToken ? (
              <div className="row">
                <button
                  type="button"
                  onClick={async () => {
                    if ((await propose.submit()) !== undefined) done();
                  }}
                >
                  Confirm: deliver request to {c.alias}
                </button>
                <button type="button" className="secondary" onClick={() => setChosen(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="secondary" onClick={() => setChosen(c)}>
                Propose {c.alias}
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          if ((await noMatch.submit()) !== undefined) done();
        }}
      >
        No match at this shelter
      </button>
    </div>
  );
}
