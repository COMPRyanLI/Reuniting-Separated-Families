import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { ErrorSummary, useSubmit } from '../../components/forms';

export interface StaffQueuesData {
  routeQueue?: { routeId: string; requestId: string; state: string; createdAt: string; assignedWorker: string | null; clues: string | null; shelterId: string }[];
  leadReview?: { requestId: string; caseReference: string; submittedAt: string }[];
  matchingTasks?: { routeId: string; assignedAt: string | null }[];
  incomingTransfers?: { transferId: string; caseReference: string; alias: string; fromShelterName: string; toShelterId: string; createdAt: string }[];
}

function useEligible(shelterId: string) {
  return useQuery({
    queryKey: ['staff', 'eligible', shelterId],
    queryFn: async () => (await api<{ staff: { membershipId: string; username: string; role: string; isYou: boolean }[] }>('GET', `/staff/shelters/${shelterId}/staff`)).staff,
  });
}

/** Routing, lead-review and transfer queues. Every list is scoped server-side to this staff member. */
export function StaffQueues({ data }: { data: StaffQueuesData }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['staff', 'tasks'] });
  const ask = useMutation({ mutationFn: (id: string) => api('POST', `/staff/requests/${id}/ask-for-lead`, {}), onSuccess: refresh });
  return (
    <>
      {data.matchingTasks && data.matchingTasks.length > 0 && (
        <section aria-labelledby="mt-h">
          <h2 id="mt-h">Your matching tasks</h2>
          <ul>
            {data.matchingTasks.map((t) => (
              <li key={t.routeId}>
                <Link to={`/staff/routes/${t.routeId}`}>Open matching task</Link>
                {t.assignedAt && <span className="small muted"> (assigned {new Date(t.assignedAt).toLocaleString()})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.routeQueue && data.routeQueue.length > 0 && (
        <section aria-labelledby="rq-h">
          <h2 id="rq-h">Requests routed to your shelter</h2>
          <p className="small muted">The requester agreed to share these clues with your team. Assign a worker to compare them with people here who opted in.</p>
          <ul className="plain">
            {data.routeQueue.map((r) => (
              <RouteRow key={r.routeId} route={r} onDone={refresh} />
            ))}
          </ul>
        </section>
      )}
      {data.leadReview && data.leadReview.length > 0 && (
        <section aria-labelledby="lr-h">
          <h2 id="lr-h">Requests from your cases without a shelter lead</h2>
          <ErrorSummary error={ask.error} />
          <ul className="plain">
            {data.leadReview.map((l) => (
              <li key={l.requestId} className="card">
                <p>
                  Case {l.caseReference}, sent {new Date(l.submittedAt).toLocaleString()}
                </p>
                <p className="small muted">No shelter lead yet. Clues are only shared with a shelter the person chooses.</p>
                <button type="button" className="secondary" onClick={() => ask.mutate(l.requestId)} disabled={ask.isPending}>
                  Ask the person for another lead
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.incomingTransfers && data.incomingTransfers.length > 0 && (
        <section aria-labelledby="it-h">
          <h2 id="it-h">Transfers waiting for your shelter</h2>
          <p className="small muted">You see only the reference and name until you verify the person in front of you.</p>
          <ul className="plain">
            {data.incomingTransfers.map((t) => (
              <TransferRow key={t.transferId} transfer={t} onDone={refresh} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function RouteRow({ route, onDone }: { route: NonNullable<StaffQueuesData['routeQueue']>[number]; onDone: () => void }) {
  const eligible = useEligible(route.shelterId);
  const [membershipId, setMembershipId] = useState('');
  const s = useSubmit(() => api('POST', `/staff/routes/${route.routeId}/assign`, { membershipId }));
  return (
    <li className="card">
      <p>
        Received {new Date(route.createdAt).toLocaleString()} · {route.state === 'NO_MATCH' ? 'No match found here' : route.assignedWorker ? `Assigned to ${route.assignedWorker}` : 'Not assigned'}
      </p>
      <p className="small">Clues: {route.clues ?? '(none)'}</p>
      <ErrorSummary error={s.error} />
      <div className="row">
        <label className="visually-hidden" htmlFor={`rw-${route.routeId}`}>
          Worker
        </label>
        <select id={`rw-${route.routeId}`} value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
          <option value="">Choose a worker</option>
          {eligible.data
            ?.filter((x) => !x.isYou)
            .map((x) => (
              <option key={x.membershipId} value={x.membershipId}>
                {x.username}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="secondary"
          disabled={!membershipId || s.pending}
          onClick={async () => {
            if ((await s.submit()) !== undefined) onDone();
          }}
        >
          Assign matching task
        </button>
      </div>
    </li>
  );
}

function TransferRow({ transfer, onDone }: { transfer: NonNullable<StaffQueuesData['incomingTransfers']>[number]; onDone: () => void }) {
  const eligible = useEligible(transfer.toShelterId);
  const [secret, setSecret] = useState('');
  const [membershipId, setMembershipId] = useState('');
  const s = useSubmit(() => api('POST', `/staff/transfers/${transfer.transferId}/accept`, { assistanceSecret: secret, membershipId }));
  return (
    <li className="card">
      <p>
        {transfer.alias} ({transfer.caseReference}) from {transfer.fromShelterName}
      </p>
      <ErrorSummary error={s.error} />
      <label htmlFor={`ts-${transfer.transferId}`}>Person’s assistance secret</label>
      <input id={`ts-${transfer.transferId}`} type="text" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
      <label htmlFor={`tw-${transfer.transferId}`}>Assign to</label>
      <select id={`tw-${transfer.transferId}`} value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
        <option value="">Choose a worker</option>
        {eligible.data
          ?.filter((x) => !x.isYou)
          .map((x) => (
            <option key={x.membershipId} value={x.membershipId}>
              {x.username}
            </option>
          ))}
      </select>
      <p>
        <button
          type="button"
          disabled={!secret || !membershipId || s.pending}
          onClick={async () => {
            if ((await s.submit()) !== undefined) onDone();
          }}
        >
          Verify and accept transfer
        </button>
      </p>
    </li>
  );
}
