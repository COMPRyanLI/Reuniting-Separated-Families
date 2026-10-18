import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OwnCheckInDto } from '@rf/contracts';
import { api } from '../lib/api';
import { CheckInForm, type CheckInBody } from '../components/CheckInForm';
import { ObservationCard } from '../components/ObservationCard';
import { ErrorSummary } from '../components/forms';
import { Loading } from '../components/guards';
import { usePageTitle } from '../components/PageTitle';

const STATE_LABEL = { SUPERSEDED: 'Replaced by a correction', DEPARTED: 'Marked as left' } as const;

export function CheckInsPage() {
  usePageTitle('Your check-ins');
  const qc = useQueryClient();
  const [formFor, setFormFor] = useState<null | { supersedes: { id: string; label: string } | null }>(null);
  const list = useQuery({ queryKey: ['me', 'check-ins'], queryFn: async () => (await api<{ checkIns: OwnCheckInDto[] }>('GET', '/me/check-ins')).checkIns });
  const depart = useMutation({
    mutationFn: (id: string) => api('POST', `/me/check-ins/${id}/depart`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'check-ins'] }),
  });

  return (
    <div className="stack">
      <h1>Your check-ins</h1>
      <p className="lead">
        A check-in records where you were at a stated time. Nobody sees it unless you share one specific check-in with one
        specific person.
      </p>
      {!formFor && (
        <button type="button" onClick={() => setFormFor({ supersedes: null })}>
          Add a check-in
        </button>
      )}
      {formFor && (
        <CheckInForm
          supersedes={formFor.supersedes}
          submit={(body: CheckInBody, key) => api('POST', '/me/check-ins', body, { idempotencyKey: key })}
          onDone={() => {
            setFormFor(null);
            void qc.invalidateQueries({ queryKey: ['me', 'check-ins'] });
          }}
          onCancel={() => setFormFor(null)}
        />
      )}
      <ErrorSummary error={depart.error} />
      <h2>History</h2>
      {list.isPending && <Loading />}
      {list.isError && <p role="alert">Could not load your check-ins. {list.error.message}</p>}
      {list.data?.length === 0 && <p>No check-ins yet. You can use the site without one.</p>}
      <ul className="plain">
        {list.data?.map((c) => {
          const label = c.place.kind === 'SHELTER' ? (c.place.shelterName ?? '') : c.place.areaLabel;
          return (
            <li key={c.id}>
              <ObservationCard
                place={c.place}
                observedAt={c.observedAt}
                source={c.source}
                isCurrentReport={c.state === 'ACTIVE'}
                stateLabel={c.state === 'ACTIVE' ? undefined : STATE_LABEL[c.state]}
                extra={
                  c.state === 'ACTIVE' && (
                    <div className="row">
                      <button type="button" className="secondary" onClick={() => setFormFor({ supersedes: { id: c.id, label } })}>
                        Correct this report
                      </button>
                      <button type="button" className="secondary" disabled={depart.isPending} onClick={() => depart.mutate(c.id)}>
                        I have left this place
                      </button>
                    </div>
                  )
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
