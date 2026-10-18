import { describe, expect, it } from 'vitest';
import { loadConfig, ConfigError } from '../../apps/api/src/config.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const SECRET_SENTINEL = 'postgresql://sentinel-user:SENTINEL_DB_PASSWORD_93@db.invalid:5432/x';

function validProduction(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: SECRET_SENTINEL,
    APP_ORIGIN: 'https://demo.example.org',
    DIGEST_KEY: KEY,
    FIELD_ENCRYPTION_KEYS: `v1:${KEY}`,
    FIELD_ENCRYPTION_ACTIVE_KEY: 'v1',
    DEMO_MODE: 'true',
  };
}

describe('FND-03 configuration validation', () => {
  it('accepts a complete production configuration', () => {
    const cfg = loadConfig(validProduction());
    expect(cfg.isProduction).toBe(true);
    expect(cfg.cookieSecure).toBe(true);
    expect(cfg.sessionCookieName).toBe('__Host-rf_session');
  });

  it('fails with safe variable names only when production secrets are missing', () => {
    const env = validProduction();
    delete env.DIGEST_KEY;
    delete env.FIELD_ENCRYPTION_KEYS;
    let error: unknown;
    try {
      loadConfig(env);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain('DIGEST_KEY');
    expect(message).toContain('FIELD_ENCRYPTION_KEYS');
    expect(message).not.toContain('SENTINEL_DB_PASSWORD_93');
  });

  it('never echoes an invalid secret value in the error', () => {
    const env = { ...validProduction(), DIGEST_KEY: 'SENTINEL_SHORT_KEY_VALUE' };
    expect(() => loadConfig(env)).toThrowError(/DIGEST_KEY/);
    try {
      loadConfig(env);
    } catch (e) {
      expect((e as Error).message).not.toContain('SENTINEL_SHORT_KEY_VALUE');
    }
  });

  it('requires an https origin in production', () => {
    const env = { ...validProduction(), APP_ORIGIN: 'http://demo.example.org' };
    expect(() => loadConfig(env)).toThrowError(/APP_ORIGIN/);
  });

  it('rejects an active key version that is not configured', () => {
    const env = { ...validProduction(), FIELD_ENCRYPTION_ACTIVE_KEY: 'v9' };
    expect(() => loadConfig(env)).toThrowError(/FIELD_ENCRYPTION_ACTIVE_KEY/);
  });
});

describe('Render free-tier configuration (one web process, generated secrets)', () => {
  const renderEnv = (): Record<string, string> => ({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db.internal:5432/x',
    RENDER_EXTERNAL_URL: 'https://reconnect-web.onrender.com',
    DIGEST_KEY: KEY,
    // Render's generateValue produces one base64 256-bit value, without a version prefix.
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    RUN_WORKER_IN_PROCESS: 'true',
  });

  it('uses Render’s public URL as the origin when APP_ORIGIN is not set', () => {
    const cfg = loadConfig(renderEnv());
    expect(cfg.appOrigin).toBe('https://reconnect-web.onrender.com');
    expect(cfg.cookieSecure).toBe(true);
  });

  it('accepts a single generated encryption key as version v1', () => {
    const cfg = loadConfig(renderEnv());
    expect(cfg.activeEncryptionKey).toBe('v1');
    expect(cfg.encryptionKeys.get('v1')?.length).toBe(32);
  });

  it('can run the outbox worker inside the web process (default off)', () => {
    expect(loadConfig(renderEnv()).runWorkerInProcess).toBe(true);
    expect(loadConfig(validProduction()).runWorkerInProcess).toBe(false);
  });

  it('treats blank variables as unset (a blank APP_ORIGIN or key version does not block the fallbacks)', () => {
    const cfg = loadConfig({ ...renderEnv(), APP_ORIGIN: '', FIELD_ENCRYPTION_KEYS: '', FIELD_ENCRYPTION_ACTIVE_KEY: '' });
    expect(cfg.appOrigin).toBe('https://reconnect-web.onrender.com');
    expect(cfg.activeEncryptionKey).toBe('v1');
  });

  it('still fails safely when neither key form is present, and an explicit APP_ORIGIN wins', () => {
    const env = renderEnv();
    delete env.FIELD_ENCRYPTION_KEY;
    expect(() => loadConfig(env)).toThrowError(/FIELD_ENCRYPTION_KEYS/);
    expect(loadConfig({ ...renderEnv(), APP_ORIGIN: 'https://reconnect.example.org' }).appOrigin).toBe('https://reconnect.example.org');
    const noOrigin = renderEnv();
    delete noOrigin.RENDER_EXTERNAL_URL;
    expect(() => loadConfig(noOrigin)).toThrowError(/APP_ORIGIN/);
  });
});
