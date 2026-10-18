import { useState, type FormEvent } from 'react';
import { ErrorSummary, Field, useSubmit } from './forms';
import { PlaceSelect } from './PlaceSelect';
import { useAreas, useShelters } from '../lib/places';
import { browserTimeZone, fromLocalInputValue, toLocalInputValue } from '../lib/format';

export interface CheckInBody {
  shelterId?: string;
  areaId?: string;
  observedAt: string;
  reportedStatus: 'UNSPECIFIED' | 'REPORTED_OK' | 'NEEDS_ASSISTANCE';
  supersedesId?: string;
  entryOrigin?: 'DIRECT' | 'PAPER';
}

interface Props {
  submit: (body: CheckInBody, idempotencyKey: string) => Promise<unknown>;
  onDone: () => void;
  onCancel?: () => void;
  supersedes?: { id: string; label: string } | null;
  forStaff?: boolean;
}

export function CheckInForm({ submit, onDone, onCancel, supersedes, forStaff }: Props) {
  const shelters = useShelters();
  const areas = useAreas();
  const [kind, setKind] = useState<'SHELTER' | 'AREA'>('SHELTER');
  const [shelterId, setShelterId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [when, setWhen] = useState(() => toLocalInputValue(new Date()));
  const [status, setStatus] = useState<CheckInBody['reportedStatus']>('UNSPECIFIED');
  const [paper, setPaper] = useState(false);
  const s = useSubmit((key) =>
    submit(
      {
        ...(kind === 'SHELTER' ? { shelterId: shelterId || undefined } : { areaId: areaId || undefined }),
        observedAt: when ? fromLocalInputValue(when) : '',
        reportedStatus: status,
        ...(supersedes ? { supersedesId: supersedes.id } : {}),
        ...(paper ? { entryOrigin: 'PAPER' as const } : {}),
      },
      key,
    ),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if ((await s.submit()) !== undefined) onDone();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="card">
      <h3>{supersedes ? `Correct: ${supersedes.label}` : 'Add a check-in'}</h3>
      {supersedes && <p className="small muted">The earlier report stays in history, marked as replaced.</p>}
      <ErrorSummary error={s.error} />
      <fieldset>
        <legend>Where {forStaff ? 'was the person' : 'were you'}?</legend>
        <div className="choice">
          <input type="radio" id="kind-shelter" name="kind" checked={kind === 'SHELTER'} onChange={() => setKind('SHELTER')} />
          <label htmlFor="kind-shelter">At a shelter</label>
        </div>
        <div className="choice">
          <input type="radio" id="kind-area" name="kind" checked={kind === 'AREA'} onChange={() => setKind('AREA')} />
          <label htmlFor="kind-area">In an area (no shelter)</label>
        </div>
      </fieldset>
      {kind === 'SHELTER' ? (
        <PlaceSelect
          query={shelters}
          noun="shelter"
          label="Shelter"
          error={s.fieldErrors.shelterId}
          placeholder="Choose a shelter"
          value={shelterId}
          onChange={setShelterId}
          optionLabel={(x) => `${x.name} (${x.area.label})`}
        />
      ) : (
        <PlaceSelect
          query={areas}
          noun="area"
          label="Area"
          hint="An approximate area, not an address."
          error={s.fieldErrors.areaId}
          placeholder="Choose an area"
          value={areaId}
          onChange={setAreaId}
          optionLabel={(x) => x.label}
        />
      )}
      <Field label={forStaff ? 'When were they there?' : 'When were you there?'} hint={`Your timezone: ${browserTimeZone()}. Earlier times are fine.`} error={s.fieldErrors.observedAt}>
        {(p) => <input {...p} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
      </Field>
      <Field label="Status at that time (optional)" hint="Recorded as a statement, not a safety check.">
        {(p) => (
          <select {...p} value={status} onChange={(e) => setStatus(e.target.value as CheckInBody['reportedStatus'])}>
            <option value="UNSPECIFIED">Not stated</option>
            <option value="REPORTED_OK">{forStaff ? 'They said they were OK' : 'I said I was OK'}</option>
            <option value="NEEDS_ASSISTANCE">{forStaff ? 'They asked for help' : 'I needed help'}</option>
          </select>
        )}
      </Field>
      {forStaff && (
        <div className="choice">
          <input id="paper" type="checkbox" checked={paper} onChange={(e) => setPaper(e.target.checked)} />
          <label htmlFor="paper">Copied from a paper intake sheet (keep the original observation time)</label>
        </div>
      )}
      <div className="row">
        <button type="submit" disabled={s.pending}>
          {s.pending ? 'Saving…' : 'Save check-in'}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
