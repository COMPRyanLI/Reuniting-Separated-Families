import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OutgoingRequestDto } from '@rf/contracts';
import { api } from '../../lib/api';
import { ErrorSummary } from '../../components/forms';
import { Loading } from '../../components/guards';
import { usePageTitle } from '../../components/PageTitle';
import { LeadForm } from '../../components/LeadForm';
import { OutgoingStatusBadge } from '../../components/StatusBadges';

export function OutgoingPage() {
  usePageTitle('Your requests');
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['requests', 'outgoing'], queryFn: async () => (await api<{ requests: OutgoingRequestDto[] }>('GET', '/requests/outgoing')).requests });
  const withdraw = useMutation({
    mutationFn: (id: string) => api('POST', `/requests/${id}/withdraw`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests', 'outgoing'] }),
  });
  const [leadFor, setLeadFor] = useState<string | null>(null);
  return (
    <div className="stack">
      <h1>Your requests</h1>
      <p className="muted">“No response available yet” is all we can say until the person chooses to answer. Unanswered requests close 14 days after sending.</p>
      <p>
        <Link className="button" to="/requests/new">
          Send a new request
        </Link>
      </p>
      <ErrorSummary error={withdraw.error} />
      {list.isPending && <Loading />}
      {list.isError && <p role="alert">Could not load your requests. {list.error.message}</p>}
      {list.data?.length === 0 && <p>You have not sent any requests.</p>}
      <ul className="plain">
        {list.data?.map((r) => (
          <li key={r.id} className="card">
            <h2 className="row">
              <span>Request sent {new Date(r.submittedAt).toLocaleString()}</span>
              <OutgoingStatusBadge status={r.status} />
            </h2>
            <p className="message-text">{r.introduction}</p>
            <p className="small muted">
              {r.routeType === 'CODE' ? 'Sent with a contact code.' : r.lead ? `Shelter lead you gave: ${r.lead.shelterName}.` : 'No shelter lead yet: nobody is looking until you add one.'}{' '}
              {r.status === 'NO_RESPONSE_YET' && `Closes ${new Date(r.expiresAt).toLocaleDateString()}.`}
            </p>
            <div className="row">
              {r.status === 'RESPONSE_AVAILABLE' && r.responseId && (
                <Link className="button" to={`/shared/${r.responseId}`}>
                  View response
                </Link>
              )}
              {r.status === 'NO_RESPONSE_YET' && r.routeType === 'ROUTED' && (
                <button type="button" className="secondary" onClick={() => setLeadFor(leadFor === r.id ? null : r.id)}>
                  Add or change shelter lead
                </button>
              )}
              {r.status === 'NO_RESPONSE_YET' && (
                <button type="button" className="secondary" disabled={withdraw.isPending} onClick={() => withdraw.mutate(r.id)}>
                  Withdraw request
                </button>
              )}
            </div>
            {leadFor === r.id && (
              <LeadForm
                version={r.version}
                submit={(body) => api('POST', `/requests/${r.id}/lead`, body)}
                onDone={() => {
                  setLeadFor(null);
                  void qc.invalidateQueries({ queryKey: ['requests', 'outgoing'] });
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
