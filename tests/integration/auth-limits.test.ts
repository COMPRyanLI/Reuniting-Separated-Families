import { describe, expect, it } from 'vitest';
import { MINUTE } from '../../apps/api/src/lib/clock.js';
import { SEED_PASSWORD } from '../support/env.js';
import { useHarness } from '../support/harness.js';

// Use the documented default limits (5 failures per username, 50 attempts per IP per 15 minutes).
const h = useHarness({ configOverrides: { RATE_LIMIT_LOGIN_IP: '50' } });
const API = '/api/v1';

describe('AUTH-06 login rate limits with a fixed clock', () => {
  it('limits failures per username, keeps other users at the shared IP working, and resets after the window', async () => {
    const c = h.client();
    for (let i = 0; i < 5; i++) {
      expect((await c.post(`${API}/auth/login`, { username: 'maya', password: `wrong password ${i}` })).status).toBe(401);
    }
    const limited = await c.post(`${API}/auth/login`, { username: 'maya', password: SEED_PASSWORD });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(JSON.stringify(limited.body)).not.toMatch(/maya/i);
    // Unknown usernames are limited identically (no existence signal).
    for (let i = 0; i < 5; i++) await c.post(`${API}/auth/login`, { username: 'ghost.user', password: `wrong password ${i}` });
    const ghost = await c.post(`${API}/auth/login`, { username: 'ghost.user', password: 'whatever pw 1' });
    expect(ghost.status).toBe(429);
    expect({ ...ghost.body.error, requestId: 0 }).toEqual({ ...limited.body.error, requestId: 0 });

    // Leo shares the shelter IP and still signs in within the IP budget.
    expect((await h.client().post(`${API}/auth/login`, { username: 'leo', password: SEED_PASSWORD })).status).toBe(200);

    h.clock.advance(15 * MINUTE);
    expect((await c.post(`${API}/auth/login`, { username: 'maya', password: SEED_PASSWORD })).status).toBe(200);
  });

  it('limits total attempts per IP at the configured budget and resets after the window', async () => {
    h.clock.advance(15 * MINUTE);
    let lastStatus = 0;
    for (let i = 0; i < 50; i++) {
      const res = await h.client().post(`${API}/auth/login`, { username: `user${i % 40}`, password: 'wrong password!!' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(401);
    const over = await h.client().post(`${API}/auth/login`, { username: 'noor', password: SEED_PASSWORD });
    expect(over.status).toBe(429);
    expect(over.headers['retry-after']).toBeDefined();
    h.clock.advance(15 * MINUTE);
    expect((await h.client().post(`${API}/auth/login`, { username: 'noor', password: SEED_PASSWORD })).status).toBe(200);
  });
});
