import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorSummary, Field, SecretBox, useSubmit } from '../components/forms';
import { usePageTitle } from '../components/PageTitle';

export function AccountPage() {
  usePageTitle('Account');
  const [password, setPassword] = useState('');
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const rotate = useSubmit(() => api<{ recoverySecret: string }>('POST', '/auth/recovery-codes', { password, kind: 'ACCOUNT_RECOVERY' }));

  async function onRotate(e: FormEvent) {
    e.preventDefault();
    const r = await rotate.submit();
    if (r) {
      setPassword('');
      setNewSecret(r.recoverySecret);
    }
  }

  return (
    <div className="narrow stack">
      <h1>Account</h1>
      <h2>Recovery secret</h2>
      <p>Replace your recovery secret if you think someone else saw it. The old one stops working immediately.</p>
      {newSecret ? (
        <>
          <SecretBox label="Your new recovery secret (shown once)" value={newSecret} />
          <button type="button" className="secondary" onClick={() => setNewSecret(null)}>
            I saved it, hide it
          </button>
        </>
      ) : (
        <>
          <ErrorSummary error={rotate.error} />
          <form onSubmit={onRotate} noValidate>
            <Field label="Confirm your password">
              {(p) => <input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <button type="submit" disabled={rotate.pending}>
              Replace recovery secret
            </button>
          </form>
        </>
      )}
      <DeleteAccount />
    </div>
  );
}

function DeleteAccount() {
  const { session } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const del = useSubmit(() => api('DELETE', '/me', { password, confirm: true }));
  if (!session?.person) return null;
  return (
    <section aria-labelledby="del-h" className="card">
      <h2 id="del-h">Delete your account and information</h2>
      <p>
        Access ends immediately and everything you shared stops working. Your check-ins, messages and profile are deleted at the same
        time. Copies other people already made cannot be recalled, and host backups, where they exist, keep older copies until they
        expire.
      </p>
      <ErrorSummary error={del.error} />
      {!open ? (
        <button type="button" className="secondary" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      ) : (
        <form
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if ((await del.submit()) !== undefined) {
              setCsrfToken(null);
              qc.clear();
              navigate('/signed-out', { replace: true });
            }
          }}
        >
          <Field label="Confirm your password">
            {(p) => <input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <div className="row">
            <button type="submit" className="danger" disabled={del.pending}>
              Permanently delete
            </button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
