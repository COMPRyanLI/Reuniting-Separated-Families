import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { REQUEST_MODE_TEXT, toLocalInputValue, fromLocalInputValue } from '../../lib/format';
import { ErrorSummary, Field, SecretBox, useSubmit } from '../../components/forms';
import { usePageTitle } from '../../components/PageTitle';

type Mode = 'CLOSED' | 'CODE_ONLY' | 'ASSISTED';
interface IntakeResult {
  caseId: string;
  reference: string;
  assistanceSecret?: string;
  contactCode?: string;
}

/** Minimal assisted intake. No legal name, phone, ID, medical or immigration details are collected. */
export function IntakePage() {
  usePageTitle('New intake');
  const [alias, setAlias] = useState('');
  const [mode, setMode] = useState<Mode>('CODE_ONLY');
  const [clue, setClue] = useState('');
  const [restricted, setRestricted] = useState(false);
  const [consent, setConsent] = useState(false);
  const [recordCheckIn, setRecordCheckIn] = useState(true);
  const [when, setWhen] = useState(() => toLocalInputValue(new Date()));
  const [issueCode, setIssueCode] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [shelterId, setShelterId] = useState('');
  // Staff who work at several shelters must say where this intake happens; nothing is picked silently.
  const me = useQuery({
    queryKey: ['staff', 'me'],
    queryFn: () => api<{ memberships: { role: string; shelter: { id: string; name: string } | null }[] }>('GET', '/staff/me'),
  });
  const myShelters = [...new Map((me.data?.memberships ?? []).filter((m) => m.role !== 'OPERATOR' && m.shelter).map((m) => [m.shelter!.id, m.shelter!])).values()];
  const s = useSubmit((key) =>
    api<IntakeResult>(
      'POST',
      '/staff/cases',
      {
        alias,
        ...(myShelters.length > 1 && shelterId ? { shelterId } : {}),
        intakeConsent: consent || undefined,
        restrictedReferral: restricted,
        ...(restricted ? {} : { requestMode: mode }),
        ...(!restricted && mode === 'ASSISTED' && clue.trim() ? { matchingClue: clue.trim() } : {}),
        ...(!restricted && recordCheckIn ? { checkIn: { observedAt: fromLocalInputValue(when) } } : {}),
        ...(!restricted && issueCode ? { issueContactCode: true } : {}),
      },
      { idempotencyKey: key },
    ),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = await s.submit();
    if (r) setResult(r);
  }

  if (result) {
    return (
      <div className="narrow stack">
        <h1>Intake saved</h1>
        <div className="card">
          <h2>Reference card</h2>
          <p>Write this on the reference card. It identifies the record but is not a password and unlocks nothing.</p>
          <p className="secret-box">{result.reference}</p>
        </div>
        {result.assistanceSecret ? (
          <div className="card">
            <h2>Private assistance secret</h2>
            <div className="alert alert-warn">
              <p>
                Give this to the person separately from the reference card. Staff will ask for it on later visits before acting
                for them. It is shown only once and is never printed on the reference card.
              </p>
            </div>
            <SecretBox label="Assistance secret" value={result.assistanceSecret} />
          </div>
        ) : (
          <div className="alert alert-info">
            <p>Restricted referral recorded. Follow the safeguarding referral process; nothing is shared through this site.</p>
          </div>
        )}
        {result.contactCode && <SecretBox label="Contact code for the person to share with family (shown once)" value={result.contactCode} />}
        <p>
          <Link to={`/staff/cases/${result.caseId}`}>Open the case</Link> · <Link to="/staff">Back to staff work</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="narrow">
      <h1>New intake</h1>
      <p className="lead">For someone without an account or phone. Only record what is needed. Ask the person before each step.</p>
      <ErrorSummary error={s.error} />
      <form onSubmit={onSubmit} noValidate>
        {myShelters.length > 1 && (
          <Field label="Shelter where this intake happens" hint="You work at more than one shelter." error={s.fieldErrors.shelterId}>
            {(p) => (
              <select {...p} value={shelterId} onChange={(e) => setShelterId(e.target.value)}>
                <option value="">Choose your shelter</option>
                {myShelters.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="Name the person wants to use" hint="Any name or nickname they choose. Not checked against ID." error={s.fieldErrors.alias}>
          {(p) => <input {...p} type="text" autoComplete="off" value={alias} onChange={(e) => setAlias(e.target.value)} />}
        </Field>
        <div className="choice">
          <input id="restricted" type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} aria-describedby="restricted-hint" />
          <label htmlFor="restricted">
            Child or person who cannot consent: restricted referral
            <span className="hint" id="restricted-hint">
              Records only a reference for the safeguarding process. No location, requests or matching.
            </span>
          </label>
        </div>
        {!restricted && (
          <>
            <fieldset>
              <legend>Who may send this person requests?</legend>
              {(Object.keys(REQUEST_MODE_TEXT) as Mode[]).map((m) => (
                <div className="choice" key={m}>
                  <input type="radio" id={`imode-${m}`} name="imode" checked={mode === m} onChange={() => setMode(m)} />
                  <label htmlFor={`imode-${m}`}>{REQUEST_MODE_TEXT[m].title}</label>
                </div>
              ))}
            </fieldset>
            {mode === 'ASSISTED' && (
              <Field label="Distinguishing clue for matching (optional)" hint="Something the person is happy for a shelter team to compare, e.g. a nickname or relative's first name. No ID, medical or legal details." error={s.fieldErrors.matchingClue}>
                {(p) => <input {...p} type="text" value={clue} onChange={(e) => setClue(e.target.value)} />}
              </Field>
            )}
            <div className="choice">
              <input id="record-checkin" type="checkbox" checked={recordCheckIn} onChange={(e) => setRecordCheckIn(e.target.checked)} />
              <label htmlFor="record-checkin">Record a check-in at this shelter</label>
            </div>
            {recordCheckIn && (
              <Field label="When were they here?" error={s.fieldErrors['checkIn.observedAt']}>
                {(p) => <input {...p} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
              </Field>
            )}
            <div className="choice">
              <input id="issue-code" type="checkbox" checked={issueCode} onChange={(e) => setIssueCode(e.target.checked)} />
              <label htmlFor="issue-code">Create a contact code the person can give to family</label>
            </div>
          </>
        )}
        <div className="choice">
          <input id="consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={s.fieldErrors.intakeConsent ? true : undefined} />
          <label htmlFor="consent">The person agreed to this intake after I explained what is recorded</label>
        </div>
        {s.fieldErrors.intakeConsent && <p className="field-error">{s.fieldErrors.intakeConsent}</p>}
        <button type="submit" disabled={s.pending}>
          {s.pending ? 'Saving…' : 'Save intake'}
        </button>
      </form>
    </div>
  );
}
