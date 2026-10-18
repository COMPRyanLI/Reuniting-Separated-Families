import { useState } from 'react';
import { api } from '../lib/api';
import { ErrorSummary, useSubmit } from './forms';

/** Reports one referenced record. Nothing else from the account is attached. */
export function AbuseReportButton({ requestId, responseId }: { requestId?: string; responseId?: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('HARASSMENT');
  const [done, setDone] = useState(false);
  const s = useSubmit(() => api('POST', '/abuse-reports', { ...(requestId ? { requestId } : { responseId }), category }));
  if (done) return <p className="small" role="status">Report recorded. Only this record is referenced.</p>;
  if (!open)
    return (
      <button type="button" className="link" onClick={() => setOpen(true)}>
        Report a problem with this
      </button>
    );
  return (
    <div className="stack">
      <ErrorSummary error={s.error} />
      <label htmlFor={`cat-${requestId ?? responseId}`}>What is wrong?</label>
      <select id={`cat-${requestId ?? responseId}`} value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="HARASSMENT">Harassment or pressure</option>
        <option value="IMPERSONATION">Pretending to be someone else</option>
        <option value="UNSAFE_CONTENT">Unsafe content</option>
        <option value="OTHER">Something else</option>
      </select>
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={s.pending}
          onClick={async () => {
            if ((await s.submit()) !== undefined) setDone(true);
          }}
        >
          Send report
        </button>
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
