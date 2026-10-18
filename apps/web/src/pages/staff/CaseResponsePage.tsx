import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ResponseDto } from '@rf/contracts';
import { api, ApiError } from '../../lib/api';
import { ResponseView } from '../../components/ResponseView';
import { Loading } from '../../components/guards';
import { usePageTitle } from '../../components/PageTitle';

/** An answer shared with the assisted person, read with them under current verification. */
export function CaseResponsePage() {
  const { caseId = '', responseId = '' } = useParams();
  usePageTitle('Answer for the person');
  const q = useQuery({ queryKey: ['staff', 'case', caseId, 'response', responseId], queryFn: () => api<ResponseDto>('GET', `/staff/cases/${caseId}/responses/${responseId}`), retry: false, gcTime: 0 });
  if (q.isPending) return <Loading />;
  if (q.isError) {
    const code = q.error instanceof ApiError ? q.error.code : '';
    return (
      <div className="narrow">
        <h1>Answer not available</h1>
        <p>{code === 'VERIFICATION_REQUIRED' ? 'Verify the person again before reading this with them.' : 'It may have expired or been withdrawn.'}</p>
        <Link to={`/staff/cases/${caseId}`}>Back to the case</Link>
      </div>
    );
  }
  return (
    <div className="narrow stack">
      <p>
        <Link to={`/staff/cases/${caseId}`}>← Back to the case</Link>
      </p>
      <h1>Answer from {q.data.sharedAlias}</h1>
      <div className="alert alert-info">
        <p>Shared with the person you are assisting, not with you or the shelter. Read it together with them; do not copy it elsewhere.</p>
      </div>
      <ResponseView response={q.data} />
    </div>
  );
}
