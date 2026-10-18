import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { REQUEST_MODE_TEXT } from '../lib/format';
import { ErrorSummary, SecretBox, useSubmit } from '../components/forms';
import { Loading } from '../components/guards';
import { usePageTitle } from '../components/PageTitle';

type Mode = 'CLOSED' | 'CODE_ONLY' | 'ASSISTED';
interface Profile {
  alias: string;
  requestMode: Mode;
  version: number;
  contactCode: { active: boolean; createdAt: string | null };
}

export function PrivacyPage() {
  usePageTitle('Privacy and contact code');
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ['me', 'profile'], queryFn: () => api<Profile>('GET', '/me') });
  const [mode, setMode] = useState<Mode>('CODE_ONLY');
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (profile.data) setMode(profile.data.requestMode);
  }, [profile.data]);

  const save = useSubmit(() => api<{ version: number }>('PATCH', '/me/privacy', { requestMode: mode, expectedVersion: profile.data!.version }));
  const rotate = useSubmit(() => api<{ contactCode: string }>('POST', '/me/contact-code/rotate', {}));

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const r = await save.submit();
    await qc.invalidateQueries({ queryKey: ['me', 'profile'] });
    if (r) setSaved(true);
  }

  if (profile.isPending) return <Loading />;
  if (profile.isError) return <p role="alert">Could not load your settings. {profile.error.message}</p>;

  return (
    <div className="narrow stack">
      <h1>Privacy and contact code</h1>
      <h2>Who can send you requests</h2>
      <ErrorSummary error={save.error} />
      {saved && (
        <p className="alert alert-ok" role="status">
          Saved. Existing shares were not changed; you can revoke them on the sharing page.
        </p>
      )}
      <form onSubmit={onSave} noValidate>
        <fieldset>
          <legend>Incoming requests</legend>
          {(Object.keys(REQUEST_MODE_TEXT) as Mode[]).map((m) => (
            <div className="choice" key={m}>
              <input type="radio" id={`mode-${m}`} name="mode" checked={mode === m} onChange={() => setMode(m)} aria-describedby={`mode-${m}-hint`} />
              <label htmlFor={`mode-${m}`}>
                <strong>{REQUEST_MODE_TEXT[m].title}</strong>
                <span className="hint" id={`mode-${m}-hint`}>
                  {REQUEST_MODE_TEXT[m].body}
                </span>
              </label>
            </div>
          ))}
        </fieldset>
        <button type="submit" disabled={save.pending}>
          Save setting
        </button>
      </form>

      <h2>Your contact code</h2>
      <p>
        Give this code only to people you want to hear from. It lets them send you a private request; it does not show them
        anything about you, and it is not a password.
      </p>
      <p className="muted">
        {profile.data.contactCode.active ? 'You have an active contact code. Replacing it stops the old one from working.' : 'You do not have a contact code yet.'}
      </p>
      <ErrorSummary error={rotate.error} />
      {code ? (
        <>
          <SecretBox label="Your contact code (shown once)" value={code} />
          <button type="button" className="secondary" onClick={() => setCode(null)}>
            I noted it, hide it
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={rotate.pending}
          onClick={async () => {
            const r = await rotate.submit();
            if (r) {
              setCode(r.contactCode);
              void qc.invalidateQueries({ queryKey: ['me', 'profile'] });
            }
          }}
        >
          {profile.data.contactCode.active ? 'Replace contact code' : 'Create contact code'}
        </button>
      )}
    </div>
  );
}
