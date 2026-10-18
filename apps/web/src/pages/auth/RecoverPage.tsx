import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { SessionDto } from '@rf/contracts';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { ErrorSummary, Field, ResultHeading, SecretBox, useSubmit } from '../../components/forms';
import { usePageTitle } from '../../components/PageTitle';

export function RecoverPage() {
  usePageTitle('Recover your account');
  const { adopt } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [recoverySecret, setRecoverySecret] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [result, setResult] = useState<{ recoverySecret: string; session: SessionDto } | null>(null);
  const [saved, setSaved] = useState(false);
  const { submit, pending, error, fieldErrors } = useSubmit(() =>
    api<{ recoverySecret: string; session: SessionDto }>('POST', '/auth/recover', { username, recoverySecret, newPassword }, { public: true }),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = await submit();
    if (r) {
      setRecoverySecret('');
      setNewPassword('');
      setResult(r);
    }
  }

  if (result) {
    return (
      <div className="narrow stack">
        <ResultHeading>Password changed</ResultHeading>
        <p>All your other sessions were signed out. Your old recovery secret no longer works. Save this new one:</p>
        <SecretBox label="Your new recovery secret" value={result.recoverySecret} />
        <div className="choice">
          <input id="saved" type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <label htmlFor="saved">I have written down my new recovery secret</label>
        </div>
        <button
          type="button"
          disabled={!saved}
          onClick={() => {
            adopt(result.session);
            navigate('/dashboard', { replace: true });
          }}
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="narrow">
      <h1>Recover your account</h1>
      <p>
        Use the recovery secret you saved when you created the account. Contact codes, case reference cards and names cannot
        be used instead. If you have lost the secret, shelter staff can help you start a new account, but they cannot open
        this one.
      </p>
      <ErrorSummary error={error} title="Could not recover the account" />
      <form onSubmit={onSubmit} noValidate>
        <Field label="Username" error={fieldErrors.username}>
          {(p) => <input {...p} type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />}
        </Field>
        <Field label="Recovery secret" error={fieldErrors.recoverySecret}>
          {(p) => <input {...p} type="text" autoComplete="off" spellCheck={false} value={recoverySecret} onChange={(e) => setRecoverySecret(e.target.value)} />}
        </Field>
        <Field label="New password" hint="At least 10 characters." error={fieldErrors.newPassword}>
          {(p) => <input {...p} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />}
        </Field>
        <button type="submit" disabled={pending}>
          {pending ? 'Checking…' : 'Set new password'}
        </button>
      </form>
    </div>
  );
}
