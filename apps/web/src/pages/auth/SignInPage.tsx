import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { SessionDto } from '@rf/contracts';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { ErrorSummary, Field, useSubmit } from '../../components/forms';
import { usePageTitle } from '../../components/PageTitle';

export function SignInPage() {
  usePageTitle('Sign in');
  const { adopt } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { submit, pending, error } = useSubmit(() =>
    api<{ session: SessionDto }>('POST', '/auth/login', { username, password }, { public: true }),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await submit();
    if (result) {
      setPassword('');
      adopt(result.session);
      navigate(result.session.staff ? '/staff' : '/dashboard', { replace: true });
    }
  }

  return (
    <div className="narrow">
      <h1>Sign in</h1>
      {params.get('ended') && (
        <div className="alert alert-info" role="status">
          <p>Your session ended. Sign in again to continue. Nothing from the previous session is shown.</p>
        </div>
      )}
      <ErrorSummary error={error} title="Could not sign in" />
      <form onSubmit={onSubmit} noValidate>
        <Field label="Username">
          {(p) => <input {...p} type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />}
        </Field>
        <Field label="Password">
          {(p) => <input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p>
        <Link to="/recover">Forgot your password? Use your recovery secret</Link>
      </p>
      <p>
        New here? <Link to="/signup">Create an account</Link>
      </p>
      <p className="small muted">On a shared or shelter computer, sign out when you finish. Sessions end after 30 minutes without activity.</p>
    </div>
  );
}
