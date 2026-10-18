import { useState, type FormEvent } from 'react';
import { ErrorSummary, Field, useSubmit } from './forms';
import { PlaceSelect } from './PlaceSelect';
import { useShelters } from '../lib/places';

interface Props {
  requesterAlias: string;
  submit: (body: Record<string, unknown>, idempotencyKey: string) => Promise<unknown>;
  onDone: () => void;
  forStaff?: boolean;
}

/** New private request: by contact code, or without one through at most one chosen shelter. */
export function RequestForm({ requesterAlias, submit, onDone, forStaff }: Props) {
  const shelters = useShelters();
  const [mode, setMode] = useState<'CODE' | 'ROUTED'>('CODE');
  const [code, setCode] = useState('');
  const [introduction, setIntroduction] = useState('');
  const [clues, setClues] = useState('');
  const [shelterId, setShelterId] = useState('');
  const [relay, setRelay] = useState(false);
  const s = useSubmit((key) =>
    submit(
      mode === 'CODE'
        ? { routeType: 'CODE', contactCode: code, introduction }
        : {
            routeType: 'ROUTED',
            introduction,
            ...(clues.trim() ? { clues: clues.trim() } : {}),
            ...(shelterId ? { destinationShelterId: shelterId, relayConsent: relay } : {}),
          },
      key,
    ),
  );
  const shelterName = shelters.data?.find((x) => x.id === shelterId)?.name;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if ((await s.submit()) !== undefined) onDone();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <ErrorSummary error={s.error} title="Not sent" />
      <fieldset>
        <legend>How {forStaff ? 'does the person' : 'do you'} want to reach them?</legend>
        <div className="choice">
          <input type="radio" id="m-code" name="m" checked={mode === 'CODE'} onChange={() => setMode('CODE')} />
          <label htmlFor="m-code">With their contact code</label>
        </div>
        <div className="choice">
          <input type="radio" id="m-routed" name="m" checked={mode === 'ROUTED'} onChange={() => setMode('ROUTED')} />
          <label htmlFor="m-routed">Without a code: ask one shelter’s team to help</label>
        </div>
      </fieldset>
      {mode === 'CODE' ? (
        <Field label="Contact code" hint="26 letters and numbers. Dashes and spaces are fine." error={s.fieldErrors.contactCode}>
          {(p) => <input {...p} type="text" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
      ) : (
        <>
          <Field
            label="Clues for the shelter team (optional)"
            hint="Only things the person would recognise, like a nickname or what they wear. Shared only with the shelter you choose."
            error={s.fieldErrors.clues}
          >
            {(p) => <textarea {...p} maxLength={500} value={clues} onChange={(e) => setClues(e.target.value)} />}
          </Field>
          <PlaceSelect
            query={shelters}
            noun="shelter"
            label="Shelter they might be at (optional)"
            hint="Choose at most one. Without a shelter, nobody searches yet."
            error={s.fieldErrors.destinationShelterId}
            placeholder="I don’t know yet"
            value={shelterId}
            onChange={setShelterId}
            optionLabel={(x) => x.name}
          />
          {shelterId && (
            <div className="choice">
              <input id="relay" type="checkbox" checked={relay} onChange={(e) => setRelay(e.target.checked)} aria-invalid={s.fieldErrors.relayConsent ? true : undefined} />
              <label htmlFor="relay">
                {forStaff ? 'The person agrees' : 'I agree'} that the clues may be shared with {shelterName}’s team so they can look for the person there.
              </label>
            </div>
          )}
          {s.fieldErrors.relayConsent && <p className="field-error">{s.fieldErrors.relayConsent}</p>}
        </>
      )}
      <Field label="Introduction" hint="Shown to the person if the request reaches them. Say who you are so they can decide." error={s.fieldErrors.introduction}>
        {(p) => <textarea {...p} maxLength={500} value={introduction} onChange={(e) => setIntroduction(e.target.value)} />}
      </Field>
      <section className="preview" aria-labelledby="req-preview">
        <h3 id="req-preview">What they will see if it reaches them</h3>
        <dl className="kv">
          <dt>From</dt>
          <dd>{requesterAlias}</dd>
          <dt>Introduction</dt>
          <dd className="message-text">{introduction || '(empty)'}</dd>
        </dl>
        <p className="small muted">They will not see your check-ins, and you will not learn whether the request reached anyone unless they answer.</p>
      </section>
      <p>
        <button type="submit" disabled={s.pending}>
          {s.pending ? 'Sending…' : 'Send private request'}
        </button>
      </p>
    </form>
  );
}
