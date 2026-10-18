import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { SessionDto } from '@rf/contracts';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { ErrorSummary, Field, ResultHeading, SecretBox, useSubmit } from '../../components/forms';
import { usePageTitle } from '../../components/PageTitle';

export function SignUpPage() {
  usePageTitle('Create an account');
  const { adopt } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [alias, setAlias] = useState('');
  const [recoverySecret, setRecoverySecret] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState<SessionDto | null>(null);
  const [saved, setSaved] = useState(false);
  const { submit, pending, error, fieldErrors } = useSubmit(() =>
    api<{ recoverySecret: string; session: SessionDto }>('POST', '/auth/register', { username, password, alias }, { public: true }),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await submit();
    if (result) {
      setPassword('');
      setRecoverySecret(result.recoverySecret);
      setPendingSession(result.session);
    }
  }

  if (recoverySecret && pendingSession) {
    return (
      <div className="narrow stack">
        <ResultHeading>Save your recovery secret</ResultHeading>
        <div className="alert alert-warn">
          <p>
            This is the only way to get back into your account if you forget your password. It is shown only once. Write it
            down and keep it private. Nobody, including shelter staff or family, can recover your account without it.
          </p>
        </div>
        <SecretBox label="Your recovery secret" value={recoverySecret} />
        <div className="choice">
          <input id="saved" type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <label htmlFor="saved">I have written down my recovery secret</label>
        </div>
        <button
          type="button"
          disabled={!saved}
          onClick={() => {
            adopt(pendingSession);
            setRecoverySecret(null);
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
      <h1>Create an account</h1>
      <p className="lead">You only need a username, a password and a name others will see. No phone, email or ID.</p>
      <ErrorSummary error={error} />
      <form onSubmit={onSubmit} noValidate>
        <Field label="Username" hint="Used only to sign in. 3-32 letters, numbers, dots, dashes or underscores." error={fieldErrors.username}>
          {(p) => <input {...p} type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />}
        </Field>
        <Field label="Password" hint="At least 10 characters. A few random words work well." error={fieldErrors.password}>
          {(p) => <input {...p} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field
          label="Name others will see"
          hint="Can be a nickname. It is only shown to people you choose to answer, and is not proof of identity."
          error={fieldErrors.alias}
        >
          {(p) => <input {...p} type="text" autoComplete="nickname" value={alias} onChange={(e) => setAlias(e.target.value)} />}
        </Field>
        <button type="submit" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="small muted">
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </div>
  );
}
