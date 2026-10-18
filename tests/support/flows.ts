import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { processDueJobs } from '../../apps/api/src/jobs/outbox.js';
import { generateSecret } from '../../apps/api/src/lib/secrets.js';
import type { Client, Harness } from './harness.js';

export const API = '/api/v1';
export const key = () => `k-${randomUUID()}`;

/** Runs the real outbox worker logic until no due jobs remain. */
export async function drain(h: Harness): Promise<number> {
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const n = await processDueJobs(h.deps);
    total += n;
    if (n === 0) break;
  }
  return total;
}

export async function contactCode(c: Client): Promise<string> {
  const res = await c.post(`${API}/me/contact-code/rotate`);
  expect(res.status).toBe(201);
  return res.body.contactCode as string;
}

export function randomWellFormedCode(): string {
  return generateSecret();
}

export async function sendCodeRequest(c: Client, code: string, introduction: string) {
  const res = await c.post(`${API}/requests`, { routeType: 'CODE', contactCode: code, introduction }, { 'Idempotency-Key': key() });
  return res;
}

export async function incoming(c: Client) {
  const res = await c.get(`${API}/requests/incoming`);
  expect(res.status).toBe(200);
  return res.body.requests as { id: string; requesterAlias: string; introduction: string; status: string; version: number }[];
}

export async function outgoing(c: Client) {
  const res = await c.get(`${API}/requests/outgoing`);
  expect(res.status).toBe(200);
  return res.body.requests as { id: string; status: string; responseId: string | null; version: number }[];
}

/** Sends a code request from `from` to `to` and returns the delivered incoming request as `to` sees it. */
export async function deliveredRequest(h: Harness, from: Client, to: Client, introduction: string) {
  const code = await contactCode(to);
  const sent = await sendCodeRequest(from, code, introduction);
  expect(sent.status).toBe(202);
  await drain(h);
  const found = (await incoming(to)).find((r) => r.id === sent.body.requestId);
  expect(found, 'request delivered').toBeDefined();
  return found!;
}

export async function respond(c: Client, requestId: string, version: number, body: Record<string, unknown>, idemKey = key()) {
  return c.post(`${API}/requests/${requestId}/respond`, { expiresIn: '7d', statement: 'REPORTED_OK', ...body, expectedVersion: version }, { 'Idempotency-Key': idemKey });
}
