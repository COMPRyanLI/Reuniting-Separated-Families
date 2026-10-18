import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../apps/api/src/app.js';
import { systemClock } from '../../apps/api/src/lib/clock.js';
import { createCrypto } from '../../apps/api/src/lib/crypto.js';
import { createLogger } from '../../apps/api/src/lib/logger.js';
import { testConfig, TEST_DIGEST_KEY, TEST_ENC_KEY_V1 } from '../support/env.js';
import { useHarness } from '../support/harness.js';

const h = useHarness();

describe('FND-02 health and readiness', () => {
  it('reports live and ready with a reachable database', async () => {
    const live = await request(h.app).get('/api/health/live');
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ status: 'live' });
    const ready = await request(h.app).get('/api/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ready', checks: { database: 'ok' } });
  });

  it('distinguishes an unavailable database: live stays 200, ready returns 503', async () => {
    const badUrl = 'postgresql://rf_nobody:SENTINEL_UNREACHABLE_PW@127.0.0.1:1/rf_test_unreachable?connect_timeout=2';
    const config = testConfig(badUrl);
    const prisma = new PrismaClient({ datasourceUrl: badUrl });
    const lines: string[] = [];
    const app = createApp({ config, prisma, clock: systemClock, crypto: createCrypto(config), logger: createLogger((l) => lines.push(l)) });
    try {
      const live = await request(app).get('/api/health/live');
      expect(live.status).toBe(200);
      const ready = await request(app).get('/api/health/ready');
      expect(ready.status).toBe(503);
      expect(ready.body).toEqual({ status: 'not_ready', checks: { database: 'unavailable' } });
      // FND-03: no connection details in the body or logs.
      const all = JSON.stringify(ready.body) + lines.join('\n');
      expect(all).not.toContain('SENTINEL_UNREACHABLE_PW');
      expect(all).not.toContain('rf_nobody');
    } finally {
      await prisma.$disconnect();
    }
  });
});

describe('FND-03 no secrets in health or error bodies', () => {
  it('health, unknown-route and malformed-body responses never echo configuration secrets', async () => {
    const bodies = [
      await request(h.app).get('/api/health/live'),
      await request(h.app).get('/api/health/ready'),
      await request(h.app).get('/api/v1/does-not-exist'),
      await request(h.app)
        .post('/api/v1/auth/login')
        .set('Origin', h.deps.config.appOrigin)
        .set('Content-Type', 'application/json')
        .send('{"broken json'),
    ].map((r) => JSON.stringify(r.body) + JSON.stringify(r.headers));
    for (const text of bodies) {
      expect(text).not.toContain(TEST_DIGEST_KEY);
      expect(text).not.toContain(TEST_ENC_KEY_V1);
      expect(text).not.toContain(h.deps.config.databaseUrl);
      expect(text).not.toMatch(/at .+\.(ts|js):\d+/); // no stack traces
    }
  });

  it('sets no-store and security headers on API responses', async () => {
    const res = await request(h.app).get('/api/health/live');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['permissions-policy']).toContain('geolocation=()');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
