/**
 * Per-file real-PostgreSQL harness: clones the seeded template database, builds the
 * real Express app with a fixed clock, and provides cookie-isolated actor clients.
 */
import { afterAll, beforeAll, inject } from 'vitest';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../apps/api/src/app.js';
import type { Deps, TestHooks } from '../../apps/api/src/deps.js';
import { FixedClock } from '../../apps/api/src/lib/clock.js';
import { createCrypto } from '../../apps/api/src/lib/crypto.js';
import { createLogger } from '../../apps/api/src/lib/logger.js';
import { createDatabase, databaseUrl, dropDatabase, randomDbName } from './db.js';
import { SEED_PASSWORD, T0, TEST_ORIGIN, testConfig } from './env.js';
import { fixtureId, STAFF, type StaffKey } from '../../prisma/fixtures.js';

export interface Harness {
  deps: Deps;
  prisma: PrismaClient;
  clock: FixedClock;
  app: ReturnType<typeof createApp>;
  logLines: string[];
  hooks: TestHooks;
  dbName: string;
  client(): Client;
  login(username: string, password?: string): Promise<Client>;
  loginStaff(key: StaffKey): Promise<Client>;
  rebuildApp(overrides?: Record<string, string>): void;
}

export class Client {
  csrf: string | undefined;
  readonly agent: ReturnType<typeof request.agent>;
  constructor(app: ReturnType<typeof createApp>) {
    this.agent = request.agent(app);
  }
  get(path: string, opts: { background?: boolean } = {}) {
    const t = this.agent.get(path).set('Origin', TEST_ORIGIN);
    return opts.background ? t.set('X-Background-Refresh', '1') : t;
  }
  private withCsrf<T extends { set(k: string, v: string): T }>(t: T): T {
    t = t.set('Origin', TEST_ORIGIN);
    return this.csrf ? t.set('X-CSRF-Token', this.csrf) : t;
  }
  post(path: string, body?: object, headers: Record<string, string> = {}) {
    let t = this.withCsrf(this.agent.post(path));
    for (const [k, v] of Object.entries(headers)) t = t.set(k, v);
    return t.send(body ?? {});
  }
  patch(path: string, body?: object, headers: Record<string, string> = {}) {
    let t = this.withCsrf(this.agent.patch(path));
    for (const [k, v] of Object.entries(headers)) t = t.set(k, v);
    return t.send(body ?? {});
  }
  delete(path: string, body?: object) {
    return this.withCsrf(this.agent.delete(path)).send(body ?? {});
  }
}

export function useHarness(options: { configOverrides?: Record<string, string> } = {}): Harness {
  const h = { logLines: [] as string[], hooks: {} as TestHooks } as Harness;
  const totpSecrets = new Map<string, string>();

  beforeAll(async () => {
    h.dbName = randomDbName();
    await createDatabase(h.dbName, inject('templateDb'));
    h.prisma = new PrismaClient({ datasourceUrl: databaseUrl(h.dbName) });
    h.clock = new FixedClock(T0);
    h.rebuildApp = (overrides = {}) => {
      // Shared-IP login budget is raised for ordinary test files because every actor logs in from
      // 127.0.0.1 under a frozen clock; the AUTH-06 file restores the documented default.
      const config = testConfig(databaseUrl(h.dbName), { RATE_LIMIT_LOGIN_IP: '100000', RATE_LIMIT_REGISTER_IP: '100000', ...options.configOverrides, ...overrides });
      h.deps = {
        config,
        prisma: h.prisma,
        clock: h.clock,
        crypto: createCrypto(config),
        logger: createLogger((line) => h.logLines.push(line)),
        hooks: h.hooks,
      };
      h.app = createApp(h.deps);
    };
    h.rebuildApp();
  });

  afterAll(async () => {
    await h.prisma?.$disconnect();
    if (h.dbName) await dropDatabase(h.dbName);
  });

  h.client = () => new Client(h.app);
  h.login = async (username, password = SEED_PASSWORD) => {
    const c = h.client();
    const res = await c.post('/api/v1/auth/login', { username, password });
    if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
    c.csrf = res.body.csrfToken;
    return c;
  };
  h.loginStaff = async (key) => {
    const username = STAFF[key].username;
    const c = await h.login(username);
    let secret = totpSecrets.get(username);
    if (!secret) {
      const enroll = await c.post('/api/v1/auth/mfa/enroll', { password: SEED_PASSWORD });
      if (enroll.status !== 200) throw new Error(`enroll failed ${enroll.status} ${JSON.stringify(enroll.body)}`);
      secret = enroll.body.secret as string;
      totpSecrets.set(username, secret);
    }
    // Each verification needs a fresh TOTP time step (replay protection).
    h.clock.advance(31_000);
    const verify = await c.post('/api/v1/auth/mfa/verify', { code: totpCode(secret, h.clock.now()) });
    if (verify.status !== 200) throw new Error(`mfa verify failed ${verify.status} ${JSON.stringify(verify.body)}`);
    c.csrf = verify.body.csrfToken;
    return c;
  };
  return h;
}

export function totpCode(base32Secret: string, at: Date): string {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(base32Secret), digits: 6, period: 30, algorithm: 'SHA1' });
  return totp.generate({ timestamp: at.getTime() });
}

export const ids = {
  person: (label: string) => fixtureId(`person:${label}`),
  assisted: (label: string) => fixtureId(`person:assisted:${label}`),
  case: (label: string) => fixtureId(`case:${label}`),
  account: (username: string) => fixtureId(`account:${username}`),
  shelter: (key: 'A' | 'B' | 'D' | 'X') => fixtureId(`shelter:shelter-${key.toLowerCase()}`),
  membership: (username: string) => fixtureId(`membership:${username}`),
  incident: (slug: string) => fixtureId(`incident:${slug}`),
};

/** Recursively collects every string in a JSON body so tests can assert on the full payload. */
export function jsonText(body: unknown): string {
  return JSON.stringify(body);
}
