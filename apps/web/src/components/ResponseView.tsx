import { SAFETY_STATEMENT_TEXT, type ResponseDto } from '@rf/contracts';
import { ObservationCard } from './ObservationCard';

/** Renders exactly the fields of a ResponseDto. Also used for the pre-approval preview. */
export function ResponseView({ response, preview = false }: { response: ResponseDto; preview?: boolean }) {
  const statement = SAFETY_STATEMENT_TEXT[response.statement];
  return (
    <div className="stack">
      <dl className="kv">
        <dt>From</dt>
        <dd>{response.sharedAlias}</dd>
        {statement && (
          <>
            <dt>Message</dt>
            <dd>{statement}</dd>
          </>
        )}
        {response.message && (
          <>
            <dt>{statement ? 'Note' : 'Message'}</dt>
            <dd className="message-text">{response.message}</dd>
          </>
        )}
        <dt>Shared</dt>
        <dd>{preview ? 'When you confirm' : new Date(response.respondedAt).toLocaleString()}</dd>
        <dt>Available until</dt>
        <dd>{preview ? response.expiresAt : new Date(response.expiresAt).toLocaleString()}</dd>
      </dl>
      {response.location ? (
        <ObservationCard
          place={{
            kind: response.location.kind,
            areaLabel: response.location.areaLabel,
            shelterName: response.location.shelterName,
            shelterAddress: response.location.shelterAddress,
          }}
          observedAt={response.location.observedAt}
          source={response.location.source}
          isCurrentReport={response.location.reportStatus === 'AS_REPORTED'}
        />
      ) : (
        <p className="muted">No location is included.</p>
      )}
    </div>
  );
}
