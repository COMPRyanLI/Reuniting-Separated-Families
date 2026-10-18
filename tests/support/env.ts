/**
 * Local-only test configuration. These values are unique sentinels so leak scans can
 * search for them; they are not reusable deployment credentials.
 */
import { createHash } from 'node:crypto';
import { loadConfig, type AppConfig } from '../../apps/api/src/config.js';
import { createCrypto } from '../../apps/api/src/lib/crypto.js';

const key = (label: string) => createHash('sha256').update(`rf-test-only:${label}`).digest().toString('base64');

export const TEST_ORIGIN = 'http://localhost:5173';
export const SEED_PASSWORD = 'test-only-seed-password-6e1f';
export const SEED_SECRET = 'test-only-seed-secret-0b7d3c9a';
export const TEST_DIGEST_KEY = key('digest');
export const TEST_ENC_KEY_V1 = key('enc-v1');

export function testConfig(databaseUrl: string, overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: TEST_ORIGIN,
    DATABASE_URL: databaseUrl,
    DIGEST_KEY: TEST_DIGEST_KEY,
    FIELD_ENCRYPTION_KEYS: `v1:${TEST_ENC_KEY_V1}`,
    FIELD_ENCRYPTION_ACTIVE_KEY: 'v1',
    DEMO_MODE: 'true',
    INCIDENT_SLUG: 'demo-hurricane-1',
    ...overrides,
  });
}

export function testCrypto(databaseUrl = 'postgresql://unused/x') {
  return createCrypto(testConfig(databaseUrl));
}

/** Fixed reference time for deterministic tests. */
export const T0 = new Date('2026-10-18T12:00:00.000Z');
