import { useState, type FormEvent } from 'react';
import type { OwnCheckInDto, ResponseDto, SafetyStatement, ShareScope } from '@rf/contracts';
import { ErrorSummary, Field, useSubmit } from './forms';
import { ResponseView } from './ResponseView';

interface Props {
  requesterAlias: string;
  subjectAlias: string;
  checkIns: OwnCheckInDto[];
  submit: (body: Record<string, unknown>, idempotencyKey: string) => Promise<unknown>;
  onDone: () => void;
  onCancel: () => void;
  forStaff?: boolean;
}

const SCOPE_TEXT: Record<ShareScope, { title: string; body: string }> = {
  SAFETY_MESSAGE: { title: 'A message only', body: 'No location at all.' },
  AREA: { title: 'Message and the approximate area of one check-in', body: 'Only the area name and when. No shelter or address.' },
  SHELTER: { title: 'Message and the named shelter of one check-in', body: 'Shelter name and public address, and when.' },
};

/**
 * One deliberate decision for one request: scope, which single check-in, message and
 * expiry, with an exact preview of what the requester will receive.
 */
export function RespondForm({ requesterAlias, subjectAlias, checkIns, submit, onDone, onCancel, forStaff }: Props) {
  const [scope, setScope] = useState<ShareScope>('SAFETY_MESSAGE');
  const [checkInId, setCheckInId] = useState('');
  const [statement, setStatement] = useState<SafetyStatement>('REPORTED_OK');
  const [message, setMessage] = useState('');
  const [expiresIn, setExpiresIn] = useState<'24h' | '7d'>('7d');
  const [confirming, setConfirming] = useState(false);
  const usable = checkIns.filter((c) => c.state === 'ACTIVE' && (scope !== 'SHELTER' || c.place.kind === 'SHELTER'));
  const chosen = usable.find((c) => c.id === checkInId);
  const s = useSubmit((key) =>
    submit(
      {
        scope,
        statement,
        ...(message.trim() ? { message: message.trim() } : {}),
        ...(scope !== 'SAFETY_MESSAGE' && checkInId ? { checkInId } : {}),
        expiresIn,
      },
      key,
    ),
  );

  const preview: ResponseDto = {
    responseId: 'preview',
    scope,
    sharedAlias: subjectAlias,
    statement,
    message: message.trim() || null,
    respondedAt: new Date().toISOString(),
    expiresAt: expiresIn === '24h' ? '24 hours after sharing' : '7 days after sharing',
    ...(scope !== 'SAFETY_MESSAGE' && chosen
      ? {
          location: {
            kind: scope === 'SHELTER' ? 'SHELTER' : 'AREA',
            areaLabel: chosen.place.areaLabel,
            ...(scope === 'SHELTER' ? { shelterName: chosen.place.shelterName, shelterAddress: chosen.place.shelterAddress } : {}),
            observedAt: chosen.observedAt,
            source: chosen.source,
            reportStatus: 'AS_REPORTED',
          },
        }
      : {}),
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    if ((await s.submit()) !== undefined) onDone();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="card">
      <h3>Answer {requesterAlias}</h3>
      <p className="small muted">{forStaff ? 'Record exactly what the person chose.' : 'Only this person receives this answer. It never includes your later check-ins.'}</p>
      <ErrorSummary error={s.error} />
      <fieldset onChange={() => setConfirming(false)}>
        <legend>What to share</legend>
        {(Object.keys(SCOPE_TEXT) as ShareScope[]).map((k) => (
          <div className="choice" key={k}>
            <input type="radio" id={`scope-${k}`} name="scope" checked={scope === k} onChange={() => setScope(k)} />
            <label htmlFor={`scope-${k}`}>
              {SCOPE_TEXT[k].title}
              <span className="hint">{SCOPE_TEXT[k].body}</span>
            </label>
          </div>
        ))}
      </fieldset>
      {scope !== 'SAFETY_MESSAGE' && (
        <Field label="Which check-in" error={s.fieldErrors.checkInId ?? s.fieldErrors.scope}>
          {(p) => (
            <select
              {...p}
              value={checkInId}
              onChange={(e) => {
                setCheckInId(e.target.value);
                setConfirming(false);
              }}
            >
              <option value="">Choose one check-in</option>
              {usable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.place.kind === 'SHELTER' ? c.place.shelterName : `Area: ${c.place.areaLabel}`} - {new Date(c.observedAt).toLocaleString()}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {scope !== 'SAFETY_MESSAGE' && usable.length === 0 && <p className="alert alert-info">No suitable check-in. Add one first, or send a message only.</p>}
      <Field label="Message">
        {(p) => (
          <select
            {...p}
            value={statement}
            onChange={(e) => {
              setStatement(e.target.value as SafetyStatement);
              setConfirming(false);
            }}
          >
            <option value="REPORTED_OK">I am OK.</option>
            <option value="NEED_HELP">I need help.</option>
            <option value="WILL_BE_IN_TOUCH">I got your message and will be in touch.</option>
            <option value="NONE">No set message (write your own below)</option>
          </select>
        )}
      </Field>
      <Field
        label="Short note (optional)"
        hint={`${280 - message.length} characters left. Check it does not reveal more than you intend, such as a room or address.`}
        error={s.fieldErrors.message}
      >
        {(p) => (
          <textarea
            {...p}
            maxLength={280}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setConfirming(false);
            }}
          />
        )}
      </Field>
      <fieldset>
        <legend>Available for</legend>
        <div className="choice">
          <input type="radio" id="exp-24h" name="exp" checked={expiresIn === '24h'} onChange={() => setExpiresIn('24h')} />
          <label htmlFor="exp-24h">24 hours</label>
        </div>
        <div className="choice">
          <input type="radio" id="exp-7d" name="exp" checked={expiresIn === '7d'} onChange={() => setExpiresIn('7d')} />
          <label htmlFor="exp-7d">7 days</label>
        </div>
        <p className="hint">You can revoke it sooner at any time. Revoking cannot erase copies someone already made.</p>
      </fieldset>
      <section className="preview" aria-labelledby="preview-h">
        <h4 id="preview-h">Exactly what {requesterAlias} will see</h4>
        <ResponseView response={preview} preview />
      </section>
      <div className="row">
        <button type="submit" disabled={s.pending || (scope !== 'SAFETY_MESSAGE' && !checkInId)}>
          {confirming ? `Confirm: share with ${requesterAlias}` : 'Review and share'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {confirming && <p role="status">Check the preview above, then confirm.</p>}
    </form>
  );
}
