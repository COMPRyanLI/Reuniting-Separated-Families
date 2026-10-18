import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GrantDto } from '@rf/contracts';
import { api } from '../../lib/api';
import { ErrorSummary } from '../../components/forms';
import { Loading } from '../../components/guards';
import { usePageTitle } from '../../components/PageTitle';

export function GrantList({ grants, onRevoke, onRevokeAll, pending, emptyText = 'You have not shared anything.' }: { grants: GrantDto[]; onRevoke: (id: string) => void; onRevokeAll: () => void; pending: boolean; emptyText?: string }) {
  const [confirmAll, setConfirmAll] = useState(false);
  const active = grants.filter((g) => g.status === 'ACTIVE');
  return (
    <div className="stack">
      {grants.length === 0 && <p>{emptyText}</p>}
      {active.length > 0 &&
        (confirmAll ? (
          <div className="alert alert-warn" role="alertdialog" aria-label="Confirm revoke all">
            <p>Stop sharing everything that is still shared ({active.length})? People will no longer be able to open it. Copies they already made cannot be recalled.</p>
            <div className="row">
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setConfirmAll(false);
                  onRevokeAll();
                }}
              >
                Revoke all
              </button>
              <button type="button" className="secondary" onClick={() => setConfirmAll(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="secondary" onClick={() => setConfirmAll(true)}>
            Revoke everything shared
          </button>
        ))}
      <ul className="plain">
        {grants.map((g) => (
          <li key={g.grantId} className="card">
            <h3 className="row">
              <span>Shared with {g.recipientAlias || '(removed account)'}</span>
              <span className={`badge ${g.status === 'ACTIVE' ? 'badge-ok' : 'badge-muted'}`}>{g.status === 'ACTIVE' ? 'Active' : g.status === 'EXPIRED' ? 'Expired' : 'Revoked'}</span>
            </h3>
            <p>
              {g.scope === 'SAFETY_MESSAGE' ? 'A message only' : g.scope === 'AREA' ? 'Message and approximate area' : 'Message and named shelter'}
              {g.sharedPlace ? `: ${g.sharedPlace}` : ''}
            </p>
            <p className="small muted">
              Shared {new Date(g.createdAt).toLocaleString()}; {g.status === 'ACTIVE' ? 'until' : 'was until'} {new Date(g.expiresAt).toLocaleString()}.
            </p>
            {g.status === 'ACTIVE' && (
              <button type="button" className="secondary" disabled={pending} onClick={() => onRevoke(g.grantId)}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SharingPage() {
  usePageTitle('Manage sharing');
  const qc = useQueryClient();
  const grants = useQuery({ queryKey: ['me', 'grants'], queryFn: async () => (await api<{ grants: GrantDto[] }>('GET', '/me/grants')).grants });
  const refresh = () => qc.invalidateQueries({ queryKey: ['me', 'grants'] });
  const revoke = useMutation({ mutationFn: (id: string) => api('POST', `/grants/${id}/revoke`, {}), onSuccess: refresh });
  const revokeAll = useMutation({ mutationFn: () => api('POST', '/me/grants/revoke-all', {}), onSuccess: refresh });
  return (
    <div className="stack">
      <h1>Manage sharing</h1>
      <p className="lead">Everything you have shared, with whom, and until when. Revoking stops future access immediately.</p>
      <ErrorSummary error={revoke.error ?? revokeAll.error} />
      {grants.isPending && <Loading />}
      {grants.isError && <p role="alert">Could not load. {grants.error.message}</p>}
      {grants.data && <GrantList grants={grants.data} pending={revoke.isPending || revokeAll.isPending} onRevoke={(id) => revoke.mutate(id)} onRevokeAll={() => revokeAll.mutate()} />}
    </div>
  );
}
