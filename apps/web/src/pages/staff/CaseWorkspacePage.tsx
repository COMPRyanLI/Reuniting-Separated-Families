import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OwnCheckInDto } from '@rf/contracts';
import { api, ApiError } from '../../lib/api';
import { REQUEST_MODE_TEXT } from '../../lib/format';
import { CheckInForm } from '../../components/CheckInForm';
import { ObservationCard } from '../../components/ObservationCard';
import { ErrorSummary, Field, SecretBox, useSubmit } from '../../components/forms';
import { Loading } from '../../components/guards';
import { usePageTitle } from '../../components/PageTitle';
import { CaseRequestSections, DeleteSection, TransferSection, type CaseRequestData } from './CaseRequestSections';

type Mode = 'CLOSED' | 'CODE_ONLY' | 'ASSISTED';
export interface CaseView extends CaseRequestData {
  caseId: string;
  reference: string;
  alias: string;
  shelter: { name: string };
  restrictedReferral: boolean;
  referralGuidance?: string;
  requestMode: Mode;
  version: number;
  escalationOpenedAt: string | null;
  assistance: { verified: boolean; verifiedUntil: string | null };
  matchingClue?: string | null;
  contactCode?: { active: boolean; createdAt: string | null };
  checkIns?: OwnCheckInDto[];
}

export function CaseWorkspacePage() {
  const { caseId = '' } = useParams();
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ['staff', 'case', caseId], queryFn: () => api<CaseView>('GET', `/staff/cases/${caseId}`) });
  usePageTitle(view.data ? `Case ${view.data.reference}` : 'Case');
  const refresh = () => qc.invalidateQueries({ queryKey: ['staff', 'case', caseId] });

  if (view.isPending) return <Loading />;
  if (view.isError) {
    const notFound = view.error instanceof ApiError && view.error.status === 404;
    return (
      <div className="narrow">
        <h1>{notFound ? 'Case not available' : 'Could not load the case'}</h1>
        <p>{notFound ? 'This case does not exist or is not assigned to you.' : view.error.message}</p>
        <Link to="/staff">Back to staff work</Link>
      </div>
    );
  }
  const c = view.data;
  return (
    <div className="stack">
      <p>
        <Link to="/staff">← Staff work</Link>
      </p>
      <div className="alert alert-info" role="note">
        <p>
          <strong>Acting for: {c.alias}</strong> (reference {c.reference}, {c.shelter.name}). You act as yourself and record this
          person’s own decisions.
        </p>
      </div>
      <h1>Case {c.reference}</h1>
      {c.restrictedReferral && (
        <div className="alert alert-warn">
          <h2>Restricted referral</h2>
          <p>{c.referralGuidance}</p>
        </div>
      )}
      {c.escalationOpenedAt && (
        <p className="alert alert-warn">Manual escalation open since {new Date(c.escalationOpenedAt).toLocaleString()}. No assisted disclosure until the person is verified.</p>
      )}
      <VerifyPanel view={c} onChange={refresh} />
      {c.assistance.verified && !c.restrictedReferral && (
        <>
          <CaseCheckIns caseId={c.caseId} checkIns={c.checkIns ?? []} onChange={refresh} />
          <CaseRequestSections view={c} onChange={refresh} />
          <CasePrivacy view={c} onChange={refresh} />
          <CaseSecrets view={c} onChange={refresh} />
          <TransferSection caseId={c.caseId} pending={c.pendingTransfer ?? null} onChange={refresh} />
          <DeleteSection caseId={c.caseId} alias={c.alias} />
        </>
      )}
    </div>
  );
}

function VerifyPanel({ view, onChange }: { view: CaseView; onChange: () => void }) {
  const [secret, setSecret] = useState('');
  const verify = useSubmit(() => api('POST', `/staff/cases/${view.caseId}/verify`, { assistanceSecret: secret }));
  const end = useMutation({ mutationFn: () => api('POST', `/staff/cases/${view.caseId}/end-assistance`, {}), onSuccess: onChange });
  const escalate = useMutation({ mutationFn: () => api('POST', `/staff/cases/${view.caseId}/escalate`, {}), onSuccess: onChange });

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if ((await verify.submit()) !== undefined) {
      setSecret('');
      onChange();
    }
  }

  if (view.assistance.verified) {
    return (
      <section className="card" aria-labelledby="verify-h">
        <h2 id="verify-h">Verified for this visit</h2>
        <p>Until {new Date(view.assistance.verifiedUntil!).toLocaleTimeString()}. Verification is yours only and ends automatically.</p>
        <button type="button" className="secondary" onClick={() => end.mutate()}>
          End assistance now
        </button>
      </section>
    );
  }
  return (
    <section className="card" aria-labelledby="verify-h">
      <h2 id="verify-h">Verify the person for this visit</h2>
      <p>Ask the person for their private assistance secret. The reference card alone is not enough.</p>
      <ErrorSummary error={verify.error} />
      <form onSubmit={onVerify} noValidate>
        <Field label="Assistance secret">
          {(p) => <input {...p} type="text" autoComplete="off" spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value)} />}
        </Field>
        <div className="row">
          <button type="submit" disabled={verify.pending}>
            Verify
          </button>
          <button type="button" className="secondary" onClick={() => escalate.mutate()} disabled={escalate.isPending}>
            Person lost their secret: open manual escalation
          </button>
        </div>
      </form>
    </section>
  );
}

function CaseCheckIns({ caseId, checkIns, onChange }: { caseId: string; checkIns: OwnCheckInDto[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const depart = useMutation({ mutationFn: (id: string) => api('POST', `/staff/cases/${caseId}/check-ins/${id}/depart`, {}), onSuccess: onChange });
  return (
    <section aria-labelledby="ci-h">
      <h2 id="ci-h">Check-ins</h2>
      {!open && (
        <button type="button" onClick={() => setOpen(true)}>
          Record a check-in
        </button>
      )}
      {open && (
        <CheckInForm
          forStaff
          submit={(body, key) => api('POST', `/staff/cases/${caseId}/check-ins`, body, { idempotencyKey: key })}
          onDone={() => {
            setOpen(false);
            onChange();
          }}
          onCancel={() => setOpen(false)}
        />
      )}
      <ErrorSummary error={depart.error} />
      {checkIns.length === 0 && <p>No check-ins recorded.</p>}
      <ul className="plain">
        {checkIns.map((c) => (
          <li key={c.id}>
            <ObservationCard
              place={c.place}
              observedAt={c.observedAt}
              source={c.source}
              isCurrentReport={c.state === 'ACTIVE'}
              extra={
                c.state === 'ACTIVE' && (
                  <button type="button" className="secondary" onClick={() => depart.mutate(c.id)}>
                    Mark as left
                  </button>
                )
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CasePrivacy({ view, onChange }: { view: CaseView; onChange: () => void }) {
  const [mode, setMode] = useState<Mode>(view.requestMode);
  const [clue, setClue] = useState(view.matchingClue ?? '');
  useEffect(() => {
    setMode(view.requestMode);
    setClue(view.matchingClue ?? '');
  }, [view.requestMode, view.matchingClue]);
  const save = useSubmit(() =>
    api('PATCH', `/staff/cases/${view.caseId}/privacy`, {
      requestMode: mode,
      ...(mode === 'ASSISTED' ? { matchingClue: clue.trim() || null } : {}),
      expectedVersion: view.version,
    }),
  );
  return (
    <section aria-labelledby="priv-h">
      <h2 id="priv-h">Who may send this person requests</h2>
      <ErrorSummary error={save.error} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if ((await save.submit()) !== undefined) onChange();
        }}
        noValidate
      >
        <fieldset>
          <legend>Record the person’s choice</legend>
          {(Object.keys(REQUEST_MODE_TEXT) as Mode[]).map((m) => (
            <div className="choice" key={m}>
              <input type="radio" id={`cmode-${m}`} name="cmode" checked={mode === m} onChange={() => setMode(m)} />
              <label htmlFor={`cmode-${m}`}>{REQUEST_MODE_TEXT[m].title}</label>
            </div>
          ))}
        </fieldset>
        {mode === 'ASSISTED' && (
          <Field label="Distinguishing clue for matching (optional)">
            {(p) => <input {...p} type="text" value={clue} onChange={(e) => setClue(e.target.value)} />}
          </Field>
        )}
        <button type="submit" disabled={save.pending}>
          Save the person’s choice
        </button>
      </form>
    </section>
  );
}

function CaseSecrets({ view, onChange }: { view: CaseView; onChange: () => void }) {
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null);
  const code = useSubmit(() => api<{ contactCode: string }>('POST', `/staff/cases/${view.caseId}/contact-code/rotate`, {}));
  const secret = useSubmit(() => api<{ assistanceSecret: string }>('POST', `/staff/cases/${view.caseId}/assistance-secret/rotate`, {}));
  return (
    <section aria-labelledby="sec-h">
      <h2 id="sec-h">Codes</h2>
      <ErrorSummary error={code.error ?? secret.error} />
      {shown ? (
        <>
          <SecretBox label={shown.label} value={shown.value} />
          <button type="button" className="secondary" onClick={() => setShown(null)}>
            Given to the person, hide it
          </button>
        </>
      ) : (
        <div className="row">
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              const r = await code.submit();
              if (r) {
                setShown({ label: 'New contact code (shown once)', value: r.contactCode });
                onChange();
              }
            }}
          >
            {view.contactCode?.active ? 'Replace contact code' : 'Create contact code'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              const r = await secret.submit();
              if (r) setShown({ label: 'New assistance secret (shown once; the old one stops working)', value: r.assistanceSecret });
            }}
          >
            Replace assistance secret
          </button>
        </div>
      )}
    </section>
  );
}
