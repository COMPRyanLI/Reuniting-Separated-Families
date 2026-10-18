import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../lib/session';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" aria-live="polite">
      {label}
    </p>
  );
}

/** UI convenience only: every protected API call is authorized again by the server. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function RequirePerson({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/signin" replace />;
  if (!session.person) return <p>This account has no personal profile. Staff tools are under “Staff work”.</p>;
  return <>{children}</>;
}

export function RequireVerifiedStaff({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/signin" replace />;
  if (!session.staff) return <p>Staff tools are only available to provisioned staff accounts.</p>;
  if (!session.staff.mfaVerified) return <Navigate to="/staff/verify" replace />;
  return <>{children}</>;
}
