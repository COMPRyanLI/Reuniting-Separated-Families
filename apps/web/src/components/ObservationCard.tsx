import { describeObservation } from '@rf/contracts';
import { browserTimeZone, useNow } from '../lib/format';

export interface ObservationPlace {
  kind: 'SHELTER' | 'AREA';
  areaLabel: string;
  shelterName?: string;
  shelterAddress?: string;
}

interface Props {
  place: ObservationPlace;
  observedAt: string;
  source: 'self_report' | 'staff_recorded';
  /** false when superseded/departed: shown as no longer current, with no new location. */
  isCurrentReport: boolean;
  stateLabel?: string;
  extra?: React.ReactNode;
}

/** Text-only historical location card. Never says "live", "here now" or "safe". */
export function ObservationCard({ place, observedAt, source, isCurrentReport, stateLabel, extra }: Props) {
  const now = useNow();
  const d = describeObservation(observedAt, now, browserTimeZone());
  return (
    <article className="card">
      <h3 className="row">
        <span>{place.kind === 'SHELTER' ? place.shelterName : `Area: ${place.areaLabel}`}</span>
        {d.isOlderReport && <span className="badge badge-warn">Older report</span>}
        {!isCurrentReport && <span className="badge badge-muted">{stateLabel ?? 'No longer current'}</span>}
      </h3>
      <dl className="kv">
        {place.kind === 'SHELTER' && (
          <>
            <dt>Area</dt>
            <dd>{place.areaLabel}</dd>
            {place.shelterAddress && (
              <>
                <dt>Address</dt>
                <dd>{place.shelterAddress}</dd>
              </>
            )}
          </>
        )}
        <dt>When</dt>
        <dd>
          {d.headline} ({d.timeText})
        </dd>
        <dt>Source</dt>
        <dd>{source === 'self_report' ? 'Reported by the person' : 'Recorded by shelter staff'}</dd>
      </dl>
      <p className="small muted">
        {isCurrentReport ? d.uncertainty : 'This report is no longer current. No newer location is shown.'} A report is not proof
        that someone is safe.
      </p>
      {extra}
    </article>
  );
}
