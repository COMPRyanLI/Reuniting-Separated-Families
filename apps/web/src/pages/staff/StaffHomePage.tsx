import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { ErrorSummary } from '../../components/forms';
import { Loading } from '../../components/guards';
import { usePageTitle } from '../../components/PageTitle';
import { StaffQueues, type StaffQueuesData } from './StaffQueues';

interface StaffMe {
  memberships: { role: string; shelter: { id: string; name: string } | null }[];
}
export interface TasksDto extends StaffQueuesData {
  cases: {
    caseId: string;
    reference: string;
    alias: string;
    shelterName: string;
    restrictedReferral: boolean;
    verifiedUntil: string | null;
    escalationOpen: boolean;
  }[];
  caseIndex: {
    caseId: string;
    reference: string;
    shelterName: string;
    createdAt: string;
    lastActivityAt: string;
    activeAssignments: number;
    reviewDue: boolean;
  }[];
}

export function StaffHomePage() {
  usePageTitle('Staff work');
  const me = useQuery({ queryKey: ['staff', 'me'], queryFn: () => api<StaffMe>('GET', '/staff/me') });
  const tasks = useQuery({ queryKey: ['staff', 'tasks'], queryFn: () => api<TasksDto>('GET', '/staff/tasks') });
  if (me.isPending || tasks.isPending) return <Loading />;
  if (me.isError || tasks.isError) return <p role="alert">Could not load staff work. {(me.error ?? tasks.error)?.message}</p>;
  const coordinatorShelters = me.data.memberships.filter((m) => m.role === 'COORDINATOR' && m.shelter).map((m) => m.shelter!);
  const canIntake = me.data.memberships.some((m) => m.role !== 'OPERATOR' && m.shelter);

  return (
    <div className="stack">
      <h1>Staff work</h1>
      <p className="muted">
        You act as yourself and only see cases assigned to you. Your role:{' '}
        {me.data.memberships.map((m) => `${m.role.toLowerCase()}${m.shelter ? ` at ${m.shelter.name}` : ''}`).join(', ')}.
      </p>
      {canIntake && (
        <p>
          <Link className="button" to="/staff/intake">
            New intake (person without account or phone)
          </Link>
        </p>
      )}
      <h2>Your assigned cases</h2>
      {tasks.data.cases.length === 0 ? (
        <p>No cases are assigned to you.</p>
      ) : (
        <ul className="plain">
          {tasks.data.cases.map((c) => (
            <li key={c.caseId} className="card">
              <h3 className="row">
                <Link to={`/staff/cases/${c.caseId}`}>
                  {c.alias} <span className="muted small">({c.reference})</span>
                </Link>
                {c.restrictedReferral && <span className="badge badge-danger">Restricted referral</span>}
                {c.escalationOpen && <span className="badge badge-warn">Manual escalation open</span>}
                {c.verifiedUntil ? <span className="badge badge-ok">Verified for this visit</span> : <span className="badge badge-muted">Not verified this visit</span>}
              </h3>
              <p className="small muted">{c.shelterName}</p>
            </li>
          ))}
        </ul>
      )}
      <StaffQueues data={tasks.data} />
      {coordinatorShelters.map((s) => (
        <CoordinatorIndex key={s.id} shelterId={s.id} shelterName={s.name} rows={tasks.data.caseIndex.filter((r) => r.shelterName === s.name)} />
      ))}
    </div>
  );
}

function CoordinatorIndex({ shelterId, shelterName, rows }: { shelterId: string; shelterName: string; rows: TasksDto['caseIndex'] }) {
  const qc = useQueryClient();
  const staff = useQuery({
    queryKey: ['staff', 'eligible', shelterId],
    queryFn: async () => (await api<{ staff: { membershipId: string; username: string; role: string; isYou: boolean }[] }>('GET', `/staff/shelters/${shelterId}/staff`)).staff,
  });
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const caseAction = useMutation({
    mutationFn: (v: { caseId: string; reference: string; action: 'close' | 'extend' }) =>
      v.action === 'close' ? api('POST', `/staff/cases/${v.caseId}/close`, {}) : api('POST', `/staff/cases/${v.caseId}/review`, { action: 'EXTEND_30_DAYS' }),
    onSuccess: (_d, v) => {
      setDone(v.action === 'close' ? `Closed ${v.reference}.` : `Kept ${v.reference} open for 30 more days.`);
      void qc.invalidateQueries({ queryKey: ['staff', 'tasks'] });
    },
  });
  const assign = useMutation({
    mutationFn: (v: { caseId: string; reference: string; membershipId: string }) =>
      api('POST', `/staff/cases/${v.caseId}/assignments`, { membershipId: v.membershipId, purposes: ['ASSIST'] }),
    onSuccess: (_d, v) => {
      setDone(`Assigned ${v.reference}.`);
      void qc.invalidateQueries({ queryKey: ['staff', 'tasks'] });
    },
  });

  return (
    <section aria-labelledby={`idx-${shelterId}`}>
      <h2 id={`idx-${shelterId}`}>Case allocation at {shelterName}</h2>
      <p className="small muted">Coordinator view: references and activity only. Assigning someone does not let you open the case.</p>
      <ErrorSummary error={assign.error ?? caseAction.error} />
      {done && (
        <p className="alert alert-ok" role="status">
          {done}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Last activity</th>
              <th scope="col">Assigned</th>
              <th scope="col">Review</th>
              <th scope="col">Assign a staff member</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.caseId}>
                <td>{r.reference}</td>
                <td>{new Date(r.lastActivityAt).toLocaleString()}</td>
                <td>{r.activeAssignments}</td>
                <td>
                  {r.reviewDue ? <span className="badge badge-warn">Review due</span> : 'OK'}
                  <div className="row">
                    {r.reviewDue && (
                      <button type="button" className="link" onClick={() => caseAction.mutate({ caseId: r.caseId, reference: r.reference, action: 'extend' })}>
                        Keep open 30 days
                      </button>
                    )}
                    <button type="button" className="link" onClick={() => caseAction.mutate({ caseId: r.caseId, reference: r.reference, action: 'close' })}>
                      Close case
                    </button>
                  </div>
                </td>
                <td>
                  <div className="row">
                    <label className="visually-hidden" htmlFor={`assign-${r.caseId}`}>
                      Staff member for {r.reference}
                    </label>
                    <select id={`assign-${r.caseId}`} value={selected[r.caseId] ?? ''} onChange={(e) => setSelected({ ...selected, [r.caseId]: e.target.value })}>
                      <option value="">Choose</option>
                      {staff.data
                        ?.filter((s) => !s.isYou)
                        .map((s) => (
                          <option key={s.membershipId} value={s.membershipId}>
                            {s.username} ({s.role.toLowerCase()})
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!selected[r.caseId] || assign.isPending}
                      onClick={() => {
                        setDone(null);
                        assign.mutate({ caseId: r.caseId, reference: r.reference, membershipId: selected[r.caseId]! });
                      }}
                    >
                      Assign
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
