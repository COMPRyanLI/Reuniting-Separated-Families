import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { SessionDto } from '@rf/contracts';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { ErrorSummary, Field, SecretBox, useSubmit } from '../../components/forms';
import { usePageTitle } from '../../components/PageTitle';

/** Staff two-step verification: enrollment (first time) and per-session verification. */
export function StaffVerifyPage() {
  usePageTitle('Staff verification');
  const { session, adopt } = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [verifiedSession, setVerifiedSession] = useState<SessionDto | null>(null);
  const enrolled = session?.staff?.mfaEnrolled ?? false;

  const enroll = useSubmit(() => api<{ secret: string; otpauthUri: string }>('POST', '/auth/mfa/enroll', { password }));
  const verify = useSubmit(() =>
    api<{ session: SessionDto; recoveryCodes?: string[] }>('POST', '/auth/mfa/verify', useRecovery ? { recoveryCode: code } : { code }),
  );

  async function onEnroll(e: FormEvent) {
    e.preventDefault();
    const r = await enroll.submit();
    if (r) {
      setPassword('');
      setEnrollment(r);
    }
  }
  async function onVerify(e: FormEvent) {
    e.preventDefault();
    const r = await verify.submit();
    if (!r) return;
    setCode('');
    if (r.recoveryCodes) {
      setRecoveryCodes(r.recoveryCodes);
      setVerifiedSession(r.session);
    } else {
      adopt(r.session);
      navigate('/staff', { replace: true });
    }
  }

  if (!session?.staff) return <p>Staff verification is only for staff accounts.</p>;

  if (recoveryCodes && verifiedSession) {
    return (
      <div className="narrow stack">
        <h1>Save your staff recovery codes</h1>
        <p>Each code works once if you lose your authenticator. They are shown only now.</p>
        <ul className="plain">
          {recoveryCodes.map((c) => (
            <li key={c} className="secret-box">
              {c}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            adopt(verifiedSession);
            navigate('/staff', { replace: true });
          }}
        >
          I saved them, continue
        </button>
      </div>
    );
  }

  return (
    <div className="narrow stack">
      <h1>Staff two-step verification</h1>
      <p>Staff tools are only available after verifying a code from your authenticator app. This protects the people you help.</p>
      {!enrolled && !enrollment && (
        <>
          <h2>Set up an authenticator</h2>
          <ErrorSummary error={enroll.error} />
          <form onSubmit={onEnroll} noValidate>
            <Field label="Confirm your password">
              {(p) => <input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <button type="submit" disabled={enroll.pending}>
              Start setup
            </button>
          </form>
        </>
      )}
      {enrollment && (
        <>
          <h2>Add this key to your authenticator app</h2>
          <SecretBox label="Setup key (time-based, 6 digits, 30 seconds)" value={enrollment.secret} />
          <p className="small muted">Or open this link on the device with the app: {enrollment.otpauthUri}</p>
        </>
      )}
      {(enrolled || enrollment) && (
        <>
          <h2>Enter a code</h2>
          <ErrorSummary error={verify.error} />
          <form onSubmit={onVerify} noValidate>
            <Field label={useRecovery ? 'Recovery code' : '6-digit code'}>
              {(p) => (
                <input
                  {...p}
                  type="text"
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.trim())}
                />
              )}
            </Field>
            <div className="row">
              <button type="submit" disabled={verify.pending}>
                Verify
              </button>
              {enrolled && (
                <button type="button" className="link" onClick={() => setUseRecovery((v) => !v)}>
                  {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
