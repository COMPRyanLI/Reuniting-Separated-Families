import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError, newIdempotencyKey } from '../lib/api';

export type FieldErrors = Record<string, string>;

export function toFieldErrors(error: unknown): FieldErrors {
  const out: FieldErrors = {};
  if (error instanceof ApiError) for (const fe of error.fieldErrors) out[fe.path] ??= fe.message;
  return out;
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode;
}

/** Label, optional hint and inline error, wired with aria-describedby/aria-invalid. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      {children({ id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true as const } : {}) })}
      {error && (
        <p className="field-error" id={errorId}>
          <span className="visually-hidden">Error: </span>
          {error}
        </p>
      )}
    </div>
  );
}

/** Focused summary of what went wrong, so keyboard and screen-reader users land on it. */
export function ErrorSummary({ error, title = 'There is a problem' }: { error: unknown; title?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  const notSubmitted = error instanceof ApiError && error.notSubmitted;
  return (
    <div className="alert alert-error" role="alert" tabIndex={-1} ref={ref}>
      <h2>{notSubmitted ? 'Not submitted' : title}</h2>
      <p>{message}</p>
      {error instanceof ApiError && error.fieldErrors.length > 0 && (
        <ul>
          {error.fieldErrors.map((f) => (
            <li key={f.path}>{f.message}</li>
          ))}
        </ul>
      )}
      {notSubmitted && <p>Your entries are still on this page (not saved anywhere else). You can try again.</p>}
      {error instanceof ApiError && error.retryAfterSeconds ? (
        <p>You can try again in about {Math.ceil(error.retryAfterSeconds / 60)} minute(s).</p>
      ) : null}
    </div>
  );
}

/**
 * Submission state for a form. The idempotency key is kept in memory for retries of
 * the same draft, and replaced only after a confirmed success.
 */
export function useSubmit<T>(fn: (idempotencyKey: string) => Promise<T>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const keyRef = useRef(newIdempotencyKey());
  async function submit(): Promise<T | undefined> {
    setPending(true);
    setError(null);
    try {
      const result = await fn(keyRef.current);
      keyRef.current = newIdempotencyKey();
      return result;
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setPending(false);
    }
  }
  return { submit, pending, error, fieldErrors: toFieldErrors(error), setError };
}

/**
 * Heading of a result that replaces a form. It takes focus when shown, so screen readers announce
 * the result and keyboard focus is not lost with the removed submit button.
 */
export function ResultHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1}>
      {children}
    </h1>
  );
}

export function SecretBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack">
      <p className="label">{label}</p>
      <p className="secret-box" aria-label={label}>
        {value}
      </p>
    </div>
  );
}
