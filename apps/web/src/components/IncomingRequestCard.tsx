import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { IncomingRequestDto, OwnCheckInDto } from '@rf/contracts';
import { ErrorSummary } from './forms';
import { RespondForm } from './RespondForm';
import { IncomingStatusBadge } from './StatusBadges';
import { AbuseReportButton } from './AbuseReportButton';

interface Props {
  request: IncomingRequestDto;
  subjectAlias: string;
  checkIns: OwnCheckInDto[];
  /** Endpoint prefix for this request, e.g. /requests/:id or /staff/cases/:c/requests/:id */
  base: string;
  call: (method: 'POST', path: string, body: unknown, key?: string) => Promise<unknown>;
  onChange: () => void;
  forStaff?: boolean;
  allowReport?: boolean;
}

/** Shared by the person’s own inbox and the verified case workspace. */
export function IncomingRequestCard({ request: r, subjectAlias, checkIns, base, call, onChange, forStaff, allowReport }: Props) {
  const [answering, setAnswering] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const act = useMutation({ mutationFn: (what: 'decline' | 'block') => call('POST', `${base}/${what}`, {}), onSuccess: onChange });
  const open = r.status === 'AWAITING_DECISION';
  return (
    <article className="card">
      <h3 className="row">
        <span>From {r.requesterAlias || '(removed account)'}</span>
        <IncomingStatusBadge status={r.status} />
      </h3>
      <p className="message-text">{r.introduction}</p>
      <p className="small muted">
        Received {new Date(r.receivedAt).toLocaleString()}. The sender’s name is their own choice and has not been verified.
        {open && ` Open until ${new Date(r.expiresAt).toLocaleDateString()}.`}
      </p>
      {r.yourResponse && (
        <p className="small">
          {forStaff ? 'Their' : 'Your'} answer: {r.yourResponse.scope.replace('_', ' ').toLowerCase()} ({r.yourResponse.grantStatus.toLowerCase()}).
        </p>
      )}
      <ErrorSummary error={act.error} />
      {open && !answering && (
        <div className="row">
          <button type="button" onClick={() => setAnswering(true)}>
            Answer
          </button>
          <button type="button" className="secondary" disabled={act.isPending} onClick={() => act.mutate('decline')}>
            Decline privately
          </button>
          <button type="button" className="secondary" onClick={() => setConfirmBlock(true)}>
            Block this sender
          </button>
        </div>
      )}
      {confirmBlock && (
        <div className="alert alert-warn" role="alertdialog" aria-labelledby={`blk-${r.id}`}>
          <p id={`blk-${r.id}`}>
            Block {r.requesterAlias}? They will not be told. Anything {forStaff ? 'the person' : 'you'} shared with them is revoked, and their future requests will not
            arrive.
          </p>
          <div className="row">
            <button
              type="button"
              className="danger"
              onClick={() => {
                setConfirmBlock(false);
                act.mutate('block');
              }}
            >
              Block
            </button>
            <button type="button" className="secondary" onClick={() => setConfirmBlock(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {answering && (
        <RespondForm
          requesterAlias={r.requesterAlias}
          subjectAlias={subjectAlias}
          checkIns={checkIns}
          forStaff={forStaff}
          submit={(body, key) => call('POST', `${base}/respond`, { ...body, expectedVersion: r.version }, key)}
          onDone={() => {
            setAnswering(false);
            onChange();
          }}
          onCancel={() => setAnswering(false)}
        />
      )}
      {allowReport && <AbuseReportButton requestId={r.id} />}
    </article>
  );
}
