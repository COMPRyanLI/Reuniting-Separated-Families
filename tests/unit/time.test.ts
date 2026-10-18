import { describe, expect, it } from 'vitest';
import { describeObservation, OLDER_REPORT_HOURS } from '../../packages/contracts/src/time.js';

const now = new Date('2026-10-18T12:00:00Z');

describe('CHECK-02 historical wording and time display', () => {
  it('always says "Last reported", shows the timezone and never claims current presence', () => {
    const d = describeObservation('2026-10-18T10:00:00Z', now, 'America/Chicago');
    expect(d.headline).toMatch(/^Last reported /);
    expect(d.timeText).toContain('CDT');
    expect(d.timeText).toContain('5:00');
    expect(d.uncertainty).toBe('Current presence is unconfirmed.');
    expect(d.isOlderReport).toBe(false);
    expect(JSON.stringify(d)).not.toMatch(/\b(live|safe now|is here|currently at)\b/i);
  });

  it('renders the same instant correctly after a timezone change', () => {
    const utc = describeObservation('2026-10-18T10:00:00Z', now, 'UTC');
    const tokyo = describeObservation('2026-10-18T10:00:00Z', now, 'Asia/Tokyo');
    expect(utc.timeText).toContain('10:00');
    expect(utc.timeText).toContain('UTC');
    expect(tokyo.timeText).toContain('7:00');
    expect(tokyo.timeText).toMatch(/GMT\+9|JST/);
  });

  it(`adds an "Older report" label after ${OLDER_REPORT_HOURS} hours`, () => {
    expect(describeObservation('2026-10-17T12:00:01Z', now, 'UTC').isOlderReport).toBe(false);
    const old = describeObservation('2026-10-17T11:59:59Z', now, 'UTC');
    expect(old.isOlderReport).toBe(true);
    expect(old.labels).toContain('Older report');
  });

  it('describes relative age without implying safety', () => {
    expect(describeObservation('2026-10-18T09:00:00Z', now, 'UTC').ageText).toBe('3 hours ago');
    expect(describeObservation('2026-10-18T11:59:00Z', now, 'UTC').ageText).toBe('1 minute ago');
    expect(describeObservation('2026-10-15T12:00:00Z', now, 'UTC').ageText).toBe('3 days ago');
  });
});
