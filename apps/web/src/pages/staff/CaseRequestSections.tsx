import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { GrantDto, IncomingRequestDto, NotificationDto, OutgoingRequestDto, OwnCheckInDto } from '@rf/contracts';
import { api } from '../../lib/api';
import { useShelters } from '../../lib/places';
import { IncomingRequestCard } from '../../components/IncomingRequestCard';
import { RequestForm } from '../../components/RequestForm';
import { LeadForm } from '../../components/LeadForm';
import { OutgoingStatusBadge } from '../../components/StatusBadges';
import { ErrorSummary, useSubmit } from '../../components/forms';
import { PlaceSelect } from '../../components/PlaceSelect';
import { GrantList } from '../requests/SharingPage';

export interface CaseRequestData {
  requests?: { outgoing: OutgoingRequestDto[]; incoming: IncomingRequestDto[] };
  grants?: GrantDto[];
  sharedWithMe?: { responseId: string; sharedAlias: string; respondedAt: string; expiresAt: string }[];
  notifications?: NotificationDto[];
  pendingTransfer?: { transferId: string; toShelterId: string; createdAt: string } | null;
}

interface View extends CaseRequestData {
  caseId: string;
  alias: string;
  checkIns?: OwnCheckInDto[];
}

/** Assisted request, response, sharing, transfer and deletion tools for a verified case. */
export function CaseRequestSections({ view, onChange }: { view: View; onChange: () => void }) {
  const base = `/staff/cases/${view.caseId}`;
  const [newRequest, setNewRequest] = useState(false);
  const [leadFor, setLeadFor] = useState<string | null>(null);
  const call = (method: 'POST', path: string, body: unknown, key?: string) => api(method, path, body, key ? { idempotencyKey: key } : {});
  const withdraw = useMutation({ mutationFn: (id: string) => api('POST', `${base}/requests/${id}/withdraw`, {}), onSuccess: onChange });
  const revoke = useMutation({ mutationFn: (id: string) => api('POST', `${base}/grants/${id}/revoke`, {}), onSuccess: onChange });
  const revokeAll = useMutation({ mutationFn: () => api('POST', `${base}/grants/revoke-all`, {}), onSuccess: onChange });
  if (!view.requests) return null;

  return (
    <>
      {view.notifications && view.notifications.length > 0 && (
        <section aria-labelledby="cn-h">
          <h2 id="cn-h">Updates for this person</h2>
          <ul>
            {view.notifications.map((n) => (
              <li key={n.id}>
                {n.text} <span className="small muted">({new Date(n.createdAt).toLocaleString()})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="inc-h">
        <h2 id="inc-h">Requests for {view.alias}</h2>
        {view.requests.incoming.length === 0 && <p>No requests have reached this person.</p>}
        <ul className="plain">
          {view.requests.incoming.map((r) => (
            <li key={r.id}>
              <IncomingRequestCard request={r} subjectAlias={view.alias} checkIns={view.checkIns ?? []} base={`${base}/requests/${r.id}`} call={call} onChange={onChange} forStaff />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="out-h">
        <h2 id="out-h">Requests {view.alias} sent</h2>
        <ErrorSummary error={withdraw.error} />
        {!newRequest ? (
          <button type="button" onClick={() => setNewRequest(true)}>
            Send a request for {view.alias}
          </button>
        ) : (
          <div className="card">
            <RequestForm
              forStaff
              requesterAlias={view.alias}
              submit={(body, key) => api('POST', `${base}/requests`, body, { idempotencyKey: key })}
              onDone={() => {
                setNewRequest(false);
                onChange();
              }}
            />
          </div>
        )}
        <ul className="plain">
          {view.requests.outgoing.map((r) => (
            <li key={r.id} className="card">
              <p className="row">
                <span>Sent {new Date(r.submittedAt).toLocaleString()}</span> <OutgoingStatusBadge status={r.status} />
              </p>
              <p className="message-text small">{r.introduction}</p>
              <div className="row">
                {r.status === 'RESPONSE_AVAILABLE' && r.responseId && (
                  <Link className="button" to={`/staff/cases/${view.caseId}/responses/${r.responseId}`}>
                    View answer with the person
                  </Link>
                )}
                {r.status === 'NO_RESPONSE_YET' && r.routeType === 'ROUTED' && (
                  <button type="button" className="secondary" onClick={() => setLeadFor(leadFor === r.id ? null : r.id)}>
                    Add or change shelter lead
                  </button>
                )}
                {r.status === 'NO_RESPONSE_YET' && (
                  <button type="button" className="secondary" onClick={() => withdraw.mutate(r.id)}>
                    Withdraw
                  </button>
                )}
              </div>
              {leadFor === r.id && (
                <LeadForm
                  forStaff
                  version={r.version}
                  submit={(body) => api('POST', `${base}/requests/${r.id}/lead`, body)}
                  onDone={() => {
                    setLeadFor(null);
                    onChange();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="gr-h">
        <h2 id="gr-h">What {view.alias} has shared</h2>
        <ErrorSummary error={revoke.error ?? revokeAll.error} />
        <GrantList grants={view.grants ?? []} emptyText="The person has not shared anything." pending={revoke.isPending || revokeAll.isPending} onRevoke={(id) => revoke.mutate(id)} onRevokeAll={() => revokeAll.mutate()} />
      </section>
    </>
  );
}

export function TransferSection({ caseId, pending, onChange }: { caseId: string; pending: { createdAt: string } | null; onChange: () => void }) {
  const shelters = useShelters();
  const [to, setTo] = useState('');
  const [consent, setConsent] = useState(false);
  const s = useSubmit(() => api('POST', `/staff/cases/${caseId}/transfers`, { toShelterId: to, personConsent: consent || undefined }));
  return (
    <section aria-labelledby="tr-h">
      <h2 id="tr-h">Move this case to another shelter</h2>
      {pending ? (
        <p>A transfer is waiting for the destination since {new Date(pending.createdAt).toLocaleString()}. They will verify the person on arrival.</p>
      ) : (
        <>
          <ErrorSummary error={s.error} />
          <PlaceSelect query={shelters} noun="shelter" label="Destination shelter" placeholder="Choose" value={to} onChange={setTo} optionLabel={(x) => x.name} />
          <div className="choice">
            <input id="tr-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <label htmlFor="tr-consent">The person chose to move their case there</label>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={!to || s.pending}
            onClick={async () => {
              if ((await s.submit()) !== undefined) onChange();
            }}
          >
            Propose transfer
          </button>
        </>
      )}
    </section>
  );
}

export function DeleteSection({ caseId, alias }: { caseId: string; alias: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const onDeleted = () => void qc.invalidateQueries({ queryKey: ['staff'] });
  const [confirm, setConfirm] = useState(false);
  const s = useSubmit(() => api('DELETE', `/staff/cases/${caseId}/person`, { confirm: true }));
  return (
    <section aria-labelledby="del-h">
      <h2 id="del-h">Delete this person’s information</h2>
      <p className="small muted">Only when {alias} asks. Access ends immediately and their content is deleted at the same time. Copies others already made cannot be recalled.</p>
      <ErrorSummary error={s.error} />
      {!confirm ? (
        <button type="button" className="secondary" onClick={() => setConfirm(true)}>
          Delete at the person’s request
        </button>
      ) : (
        <div className="row">
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if ((await s.submit()) !== undefined) {
                onDeleted();
                navigate('/staff', { replace: true });
              }
            }}
          >
            Confirm deletion
          </button>
          <button type="button" className="secondary" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
