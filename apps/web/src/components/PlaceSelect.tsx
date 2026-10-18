import type { UseQueryResult } from '@tanstack/react-query';
import { Field } from './forms';

interface Props<T extends { id: string }> {
  query: UseQueryResult<T[]>;
  /** Used in status text, e.g. "shelter" -> "Loading the shelter list…". */
  noun: 'shelter' | 'area';
  label: string;
  hint?: string;
  error?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  optionLabel: (item: T) => string;
}

/**
 * Select for public place lists that load asynchronously. Until the options arrive the
 * control is disabled and a status message says so; a failed load is announced with a
 * retry button, so an empty list is never mistaken for "no shelters".
 */
export function PlaceSelect<T extends { id: string }>({ query, noun, label, hint, error, placeholder, value, onChange, optionLabel }: Props<T>) {
  const ready = query.isSuccess;
  return (
    <>
      <Field label={label} hint={hint} error={error}>
        {(p) => (
          <select {...p} value={value} disabled={!ready} aria-busy={query.isPending || undefined} onChange={(e) => onChange(e.target.value)}>
            <option value="">{query.isPending ? `Loading ${noun}s…` : placeholder}</option>
            {query.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {optionLabel(item)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {query.isPending && (
        <p role="status" className="small muted">
          Loading the {noun} list…
        </p>
      )}
      {query.isError && (
        <div role="alert" className="alert alert-error">
          <p>Could not load the {noun} list. Check your connection.</p>
          <button type="button" className="secondary" onClick={() => void query.refetch()}>
            Try loading {noun}s again
          </button>
        </div>
      )}
    </>
  );
}
