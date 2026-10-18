import { useState, type FormEvent } from 'react';
import { ErrorSummary, Field, useSubmit } from './forms';
import { PlaceSelect } from './PlaceSelect';
import { useShelters } from '../lib/places';

/** New shelter lead for a no-code request; always requires a fresh relay choice. */
export function LeadForm({ version, submit, onDone, forStaff }: { version: number; submit: (body: Record<string, unknown>) => Promise<unknown>; onDone: () => void; forStaff?: boolean }) {
  const shelters = useShelters();
  const [shelterId, setShelterId] = useState('');
  const [clues, setClues] = useState('');
  const [relay, setRelay] = useState(false);
  const s = useSubmit(() =>
    submit({ destinationShelterId: shelterId, ...(clues.trim() ? { clues: clues.trim() } : {}), relayConsent: relay || undefined, expectedVersion: version }),
  );
  const name = shelters.data?.find((x) => x.id === shelterId)?.name ?? 'that shelter';
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if ((await s.submit()) !== undefined) onDone();
  }
  return (
    <form onSubmit={onSubmit} noValidate className="card">
      <ErrorSummary error={s.error} title="Lead not saved" />
      <PlaceSelect
        query={shelters}
        noun="shelter"
        label="Shelter lead"
        error={s.fieldErrors.destinationShelterId}
        placeholder="Choose a shelter"
        value={shelterId}
        onChange={setShelterId}
        optionLabel={(x) => x.name}
      />
      <Field label="Updated clues (optional)">{(p) => <textarea {...p} maxLength={500} value={clues} onChange={(e) => setClues(e.target.value)} />}</Field>
      <div className="choice">
        <input id="lead-relay" type="checkbox" checked={relay} onChange={(e) => setRelay(e.target.checked)} />
        <label htmlFor="lead-relay">
          {forStaff ? 'The person agrees' : 'I agree'} that the clues may be shared with {name}’s team. Any previous shelter stops working on it.
        </label>
      </div>
      {s.fieldErrors.relayConsent && <p className="field-error">{s.fieldErrors.relayConsent}</p>}
      <button type="submit" disabled={s.pending || !shelterId}>
        Save lead
      </button>
    </form>
  );
}
