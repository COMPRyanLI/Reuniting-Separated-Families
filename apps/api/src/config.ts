import { z } from 'zod';

export class ConfigError extends Error {
  constructor(public readonly variables: string[]) {
    // Variable names only; never values.
    super(`Missing or invalid configuration: ${variables.join(', ')}`);
    this.name = 'ConfigError';
  }
}

const base64Key = z
  .string()
  .refine((v) => {
    try {
      return Buffer.from(v, 'base64').length >= 32;
    } catch {
      return false;
    }
  });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1).refine((v) => /^postgres(ql)?:\/\//.test(v)),
  DIGEST_KEY: base64Key,
  FIELD_ENCRYPTION_KEYS: z.string().min(1),
  FIELD_ENCRYPTION_ACTIVE_KEY: z.string().regex(/^v\d+$/).default('v1'),
  DEMO_MODE: z.enum(['true', 'false']).default('true'),
  INCIDENT_SLUG: z.string().min(1).default('demo-hurricane-1'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(2000),
  RETENTION_INTERVAL_MS: z.coerce.number().int().min(1000).default(600_000),
  WEB_DIST_DIR: z.string().optional(),
  RUN_WORKER_IN_PROCESS: z.enum(['true', 'false']).default('false'),
  RATE_LIMIT_LOGIN_IP: z.coerce.number().int().min(1).default(50),
  RATE_LIMIT_LOGIN_USER: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_REGISTER_IP: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_REQUESTS_PER_HOUR: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_ASSIST_VERIFY: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_STAFF_INTAKE_PER_HOUR: z.coerce.number().int().min(1).default(60),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  appOrigin: string;
  databaseUrl: string;
  digestKey: Buffer;
  encryptionKeys: Map<string, Buffer>;
  activeEncryptionKey: string;
  demoMode: boolean;
  incidentSlug: string;
  trustProxy: number;
  workerPollMs: number;
  retentionIntervalMs: number;
  cookieSecure: boolean;
  sessionCookieName: string;
  webDistDir: string | undefined;
  /** Single-process hosting (e.g. a free web service): the API process also runs the outbox worker. */
  runWorkerInProcess: boolean;
  limits: {
    loginIp: number;
    loginUser: number;
    registerIp: number;
    requestsPerHour: number;
    assistVerify: number;
    staffIntakePerHour: number;
  };
}

function parseKeys(raw: string): Map<string, Buffer> | null {
  const map = new Map<string, Buffer>();
  for (const part of raw.split(',')) {
    const [version, key] = part.trim().split(':');
    if (!version || !key || !/^v\d+$/.test(version)) return null;
    const buf = Buffer.from(key, 'base64');
    if (buf.length !== 32) return null;
    map.set(version, buf);
  }
  return map.size > 0 ? map : null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  // Hosting conveniences: Render sets RENDER_EXTERNAL_URL, and its generated secrets are a single
  // base64 value, accepted as encryption key version v1. Explicit settings always win.
  // A blank variable counts as unset.
  const input: Record<string, string | undefined> = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  if (!input.APP_ORIGIN && input.RENDER_EXTERNAL_URL) input.APP_ORIGIN = input.RENDER_EXTERNAL_URL;
  if (!input.FIELD_ENCRYPTION_KEYS && input.FIELD_ENCRYPTION_KEY) input.FIELD_ENCRYPTION_KEYS = `v1:${input.FIELD_ENCRYPTION_KEY}`;
  const parsed = schema.safeParse(input);
  const bad = new Set<string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) bad.add(String(issue.path[0] ?? 'UNKNOWN'));
    throw new ConfigError([...bad].sort());
  }
  const v = parsed.data;
  const keys = parseKeys(v.FIELD_ENCRYPTION_KEYS);
  if (!keys) bad.add('FIELD_ENCRYPTION_KEYS');
  else if (!keys.has(v.FIELD_ENCRYPTION_ACTIVE_KEY)) bad.add('FIELD_ENCRYPTION_ACTIVE_KEY');
  const isProduction = v.NODE_ENV === 'production';
  const origin = new URL(v.APP_ORIGIN);
  if (isProduction && origin.protocol !== 'https:') bad.add('APP_ORIGIN');
  if (origin.pathname !== '/' || origin.search || origin.hash) bad.add('APP_ORIGIN');
  if (bad.size > 0) throw new ConfigError([...bad].sort());

  const cookieSecure = origin.protocol === 'https:';
  return {
    nodeEnv: v.NODE_ENV,
    isProduction,
    port: v.PORT,
    appOrigin: origin.origin,
    databaseUrl: v.DATABASE_URL,
    digestKey: Buffer.from(v.DIGEST_KEY, 'base64'),
    encryptionKeys: keys!,
    activeEncryptionKey: v.FIELD_ENCRYPTION_ACTIVE_KEY,
    demoMode: v.DEMO_MODE === 'true',
    incidentSlug: v.INCIDENT_SLUG,
    trustProxy: v.TRUST_PROXY,
    workerPollMs: v.WORKER_POLL_MS,
    retentionIntervalMs: v.RETENTION_INTERVAL_MS,
    cookieSecure,
    // __Host- prefix requires Secure, path=/ and no Domain attribute.
    sessionCookieName: cookieSecure ? '__Host-rf_session' : 'rf_session',
    webDistDir: v.WEB_DIST_DIR,
    runWorkerInProcess: v.RUN_WORKER_IN_PROCESS === 'true',
    limits: {
      loginIp: v.RATE_LIMIT_LOGIN_IP,
      loginUser: v.RATE_LIMIT_LOGIN_USER,
      registerIp: v.RATE_LIMIT_REGISTER_IP,
      requestsPerHour: v.RATE_LIMIT_REQUESTS_PER_HOUR,
      assistVerify: v.RATE_LIMIT_ASSIST_VERIFY,
      staffIntakePerHour: v.RATE_LIMIT_STAFF_INTAKE_PER_HOUR,
    },
  };
}
