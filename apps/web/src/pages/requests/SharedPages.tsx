import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ResponseDto } from '@rf/contracts';
import { api, ApiError } from '../../lib/api';
import { ResponseView } from '../../components/ResponseView';
import { AbuseReportButton } from '../../components/AbuseReportButton';
import { Loading } from '../../components/guards';
import { usePageTitle } from '../../components/PageTitle';

interface SharedItem {
  responseId: string;
  sharedAlias: string;
  scope: string;
  respondedAt: string;
  expiresAt: string;
}

export function SharedListPage() {
  usePageTitle('Shared with you');
  const list = useQuery({ queryKey: ['responses'], queryFn: async () => (await api<{ responses: SharedItem[] }>('GET', '/responses')).responses });
  return (
    <div className="stack">
      <h1>Shared with you</h1>
      <p className="muted">Answers people chose to share with you. Each one disappears when it expires or is revoked.</p>
      {list.isPending && <Loading />}
      {list.isError && <p role="alert">Could not load. {list.error.message}</p>}
      {list.data?.length === 0 && <p>Nothing is shared with you right now.</p>}
      <ul className="plain">
        {list.data?.map((r) => (
          <li key={r.responseId} className="card">
            <Link to={`/shared/${r.responseId}`}>Answer from {r.sharedAlias}</Link>
            <p className="small muted">
              Shared {new Date(r.respondedAt).toLocaleString()}, available until {new Date(r.expiresAt).toLocaleString()}.
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Always fetched fresh (no cache): a revoked or expired answer shows nothing on the next load. */
export function SharedDetailPage() {
  const { responseId = '' } = useParams();
  usePageTitle('Shared answer');
  const q = useQuery({
    queryKey: ['responses', responseId],
    queryFn: () => api<ResponseDto>('GET', `/responses/${responseId}`),
    retry: false,
    gcTime: 0,
  });
  if (q.isPending) return <Loading />;
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="narrow">
        <h1>{gone ? 'This answer is not available' : 'Could not load the answer'}</h1>
        <p>{gone ? 'It may have expired or been withdrawn by the person who shared it.' : q.error.message}</p>
        <Link to="/requests/outgoing">Back to your requests</Link>
      </div>
    );
  }
  return (
    <div className="narrow stack">
      <h1>Answer from {q.data.sharedAlias}</h1>
      <div className="alert alert-info">
        <p>This is what they chose to share with you only. A check-in is a past report, not where they are now. Please do not pass it on.</p>
      </div>
      <ResponseView response={q.data} />
      <AbuseReportButton responseId={q.data.responseId} />
    </div>
  );
}
