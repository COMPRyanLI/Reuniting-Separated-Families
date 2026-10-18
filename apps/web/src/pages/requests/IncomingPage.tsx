import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IncomingRequestDto, OwnCheckInDto } from '@rf/contracts';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { IncomingRequestCard } from '../../components/IncomingRequestCard';
import { Loading } from '../../components/guards';
import { usePageTitle } from '../../components/PageTitle';

export function IncomingPage() {
  usePageTitle('Requests for you');
  const { session } = useSession();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['requests', 'incoming'], queryFn: async () => (await api<{ requests: IncomingRequestDto[] }>('GET', '/requests/incoming')).requests });
  const checkIns = useQuery({ queryKey: ['me', 'check-ins'], queryFn: async () => (await api<{ checkIns: OwnCheckInDto[] }>('GET', '/me/check-ins')).checkIns });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['requests'] });
    void qc.invalidateQueries({ queryKey: ['me', 'grants'] });
  };
  return (
    <div className="stack">
      <h1>Requests for you</h1>
      <p className="lead">You decide whether to answer and exactly what to share. Declining or blocking is never shown to the sender.</p>
      {(list.isPending || checkIns.isPending) && <Loading />}
      {list.isError && <p role="alert">Could not load requests. {list.error.message}</p>}
      {list.data?.length === 0 && <p>No requests have reached you. That does not mean nobody is looking: requests only arrive if you shared a code or opted into shelter help.</p>}
      <ul className="plain">
        {list.data?.map((r) => (
          <li key={r.id}>
            <IncomingRequestCard
              request={r}
              subjectAlias={session?.person?.alias ?? ''}
              checkIns={checkIns.data ?? []}
              base={`/requests/${r.id}`}
              call={(method, path, body, key) => api(method, path, body, key ? { idempotencyKey: key } : {})}
              onChange={refresh}
              allowReport
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
