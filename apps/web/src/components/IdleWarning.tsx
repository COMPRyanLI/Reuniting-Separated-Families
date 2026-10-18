import { useEffect, useState } from 'react';
import { api, lastServerActivity } from '../lib/api';
import { useSession } from '../lib/session';

const WARN_BEFORE_MS = 2 * 60_000;

/**
 * Shared-device protection: warns two minutes before the server-side idle timeout and
 * lets the person stay signed in. Background polling does not count as activity.
 */
export function IdleWarning() {
  const { session, endSession } = useSession();
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => {
      const left = lastServerActivity() + session.idleTimeoutSeconds * 1000 - Date.now();
      setRemaining(left <= WARN_BEFORE_MS ? Math.max(0, left) : null);
      if (left <= 0) endSession(); // the server has ended it too; clear every cached private view
    }, 5_000);
    return () => clearInterval(t);
  }, [session, endSession]);
  if (!session || remaining === null) return null;
  return (
    <div className="alert alert-warn" role="alertdialog" aria-live="assertive" aria-labelledby="idle-h">
      <h2 id="idle-h">Still there?</h2>
      <p>For privacy on shared devices you will be signed out in about {Math.ceil(remaining / 60_000)} minute(s).</p>
      <button type="button" onClick={() => void api('GET', '/auth/session').then(() => setRemaining(null))}>
        Stay signed in
      </button>
    </div>
  );
}
