import { useEffect, useState } from 'react';

/** Value for <input type="datetime-local"> in the browser's local timezone. */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converts a datetime-local value (interpreted in the browser's timezone) to an ISO instant. */
export function fromLocalInputValue(v: string): string {
  return new Date(v).toISOString();
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Re-renders periodically so relative times ("3 hours ago") stay honest. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const REQUEST_MODE_TEXT: Record<'CLOSED' | 'CODE_ONLY' | 'ASSISTED', { title: string; body: string }> = {
  CLOSED: {
    title: 'Closed',
    body: 'Nobody can send you new requests. Your existing shares stay as they are until you revoke them.',
  },
  CODE_ONLY: {
    title: 'Contact code only (default)',
    body: 'Only people you give your private contact code to can send you a request.',
  },
  ASSISTED: {
    title: 'Contact code and shelter-assisted matching',
    body:
      'Also lets a shelter team that you are registered with consider you when someone asks them for help without a code. Without an active shelter case, this changes nothing beyond the contact code.',
  },
};
