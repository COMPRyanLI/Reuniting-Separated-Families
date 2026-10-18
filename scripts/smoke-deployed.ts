/**
 * DEPLOY-01/02 smoke test against an explicit base URL. Non-destructive: it only creates new
 * fictional accounts with random usernames and never resets or deletes shared data.
 *   npm run smoke:deployed -- --base-url https://your-demo.example
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { 'base-url': { type: 'string' } } });
const base = (values['base-url'] ?? process.env.SMOKE_BASE_URL ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('Usage: npm run smoke:deployed -- --base-url https://host');
  process.exit(2);
}
const httpsTarget = base.startsWith('https://');
const results: { check: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
};

class Agent {
  cookie = '';
  csrf = '';
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: base, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(this.csrf && method !== 'GET' ? { 'X-CSRF-Token': this.csrf } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0]!;
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // non-JSON
    }
    return { status: res.status, json, text, setCookie };
  }
  async register(alias: string) {
    const username = `smoke.${randomBytes(4).toString('hex')}`;
    const r = await this.req('POST', '/auth/register', { username, password: `smoke passphrase ${randomBytes(4).toString('hex')}`, alias });
    this.csrf = ((r.json.session as Record<string, unknown>)?.csrfToken as string) ?? '';
    return r;
  }
}
const key = () => `smoke-${randomBytes(8).toString('hex')}`;

async function main() {
  const live = await fetch(`${base}/api/health/live`);
  check('liveness 200', live.status === 200);
  const ready = await fetch(`${base}/api/health/ready`);
  check('readiness 200 (database reachable)', ready.status === 200, `status ${ready.status}`);
  const home = await fetch(`${base}/`);
  const html = await home.text();
  check('home page served', home.status === 200 && html.includes('<div id="root">'));
  const nested = await fetch(`${base}/requests/outgoing`);
  check('nested route reload served by the app shell', nested.status === 200);
  check('private API returns 401 without a session', (await new Agent().req('GET', '/me')).status === 401);

  const subject = new Agent();
  const reg = await subject.register('Smoke Subject (fictional)');
  check('signup with username, password and alias only', reg.status === 201);
  if (httpsTarget) check('session cookie is __Host-, Secure and HttpOnly', /^__Host-rf_session=.*;.*Secure/i.test(reg.setCookie ?? '') && /HttpOnly/i.test(reg.setCookie ?? ''));
  const shelters = (await subject.req('GET', '/shelters')).json.shelters as { id: string }[];
  const ci = await subject.req('POST', '/me/check-ins', { shelterId: shelters[0]!.id, observedAt: new Date().toISOString() }, { 'Idempotency-Key': key() });
  check('check-in saved', ci.status === 201);
  const code = (await subject.req('POST', '/me/contact-code/rotate')).json.contactCode as string;

  const requester = new Agent();
  await requester.register('Smoke Requester (fictional)');
  const sent = await requester.req('POST', '/requests', { routeType: 'CODE', contactCode: code, introduction: 'Smoke test request (fictional)' }, { 'Idempotency-Key': key() });
  check('request accepted with neutral 202', sent.status === 202 && sent.json.status === 'submitted');

  let incoming: { id: string; version: number }[] = [];
  for (let i = 0; i < 30 && incoming.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    incoming = ((await subject.req('GET', '/requests/incoming')).json.requests as { id: string; version: number }[]) ?? [];
  }
  check('background worker delivered the request', incoming.length === 1, `${incoming.length} delivered`);
  if (incoming.length === 1) {
    const ans = await subject.req('POST', `/requests/${incoming[0]!.id}/respond`, { scope: 'AREA', checkInId: (ci.json.checkIn as { id: string }).id, statement: 'REPORTED_OK', expiresIn: '24h', expectedVersion: incoming[0]!.version }, { 'Idempotency-Key': key() });
    check('recipient approved an area-only answer', ans.status === 201);
    const out = (await requester.req('GET', '/requests/outgoing')).json.requests as { responseId: string | null }[];
    const responseId = out[0]?.responseId;
    const view = await requester.req('GET', `/responses/${responseId}`);
    const loc = view.json.location as Record<string, unknown> | undefined;
    check('requester reads exactly the area scope', view.status === 200 && !!loc && loc.kind === 'AREA' && !('shelterName' in loc));
    const outsider = new Agent();
    await outsider.register('Smoke Outsider (fictional)');
    check('outsider gets the neutral 404', (await outsider.req('GET', `/responses/${responseId}`)).status === 404);
    const grants = (await subject.req('GET', '/me/grants')).json.grants as { grantId: string }[];
    check('revocation succeeds', (await subject.req('POST', `/grants/${grants[0]!.grantId}/revoke`)).status === 200);
    check('revoked answer is no longer returned', (await requester.req('GET', `/responses/${responseId}`)).status === 404);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${base} at ${new Date().toISOString()}`);
  process.exit(failed.length ? 1 : 0);
}

void main().catch((e: unknown) => {
  console.error(`smoke failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
