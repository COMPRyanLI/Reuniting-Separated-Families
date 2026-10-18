import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { RequestForm } from '../../components/RequestForm';
import { usePageTitle } from '../../components/PageTitle';

export function FindSomeonePage() {
  usePageTitle('Find someone');
  const { session } = useSession();
  const qc = useQueryClient();
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <div className="narrow stack">
        <h1>Request saved</h1>
        <div className="alert alert-ok" role="status">
          <p>
            Your request was saved. For everyone’s safety we never say whether a code matched someone, or whether a request was
            read. If the person chooses to answer, you will see it under your requests.
          </p>
        </div>
        <p>
          <Link to="/requests/outgoing">See your requests</Link> ·{' '}
          <button type="button" className="link" onClick={() => setSent(false)}>
            Send another
          </button>
        </p>
      </div>
    );
  }
  return (
    <div className="narrow">
      <h1>Find someone</h1>
      <p className="lead">There is no list of people to search. Send a private request instead; the other person decides whether to answer.</p>
      <RequestForm
        requesterAlias={session?.person?.alias ?? ''}
        submit={(body, key) => api('POST', '/requests', body, { idempotencyKey: key })}
        onDone={() => {
          setSent(true);
          void qc.invalidateQueries({ queryKey: ['requests'] });
        }}
      />
    </div>
  );
}
