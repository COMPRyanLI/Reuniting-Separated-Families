/**
 * Wording for historical reports, shared by API tests and the web UI.
 * A report is never presented as a current position or as proof of safety.
 */
export const OLDER_REPORT_HOURS = 24;
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface ObservationDescription {
  headline: string;
  timeText: string;
  ageText: string;
  uncertainty: string;
  isOlderReport: boolean;
  labels: string[];
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

export function ageText(observedAt: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - observedAt.getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, 'hour');
  return plural(Math.floor(hours / 24), 'day');
}

export function formatInstant(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

export function describeObservation(observedAtIso: string, now: Date, timeZone?: string): ObservationDescription {
  const observedAt = new Date(observedAtIso);
  const isOlderReport = now.getTime() - observedAt.getTime() > OLDER_REPORT_HOURS * 3600_000;
  const age = ageText(observedAt, now);
  return {
    headline: `Last reported ${age}`,
    timeText: formatInstant(observedAtIso, timeZone),
    ageText: age,
    uncertainty: 'Current presence is unconfirmed.',
    isOlderReport,
    labels: isOlderReport ? ['Older report'] : [],
  };
}
