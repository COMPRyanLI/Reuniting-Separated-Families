import type { Deps } from '../deps.js';
import { rateLimited } from '../lib/errors.js';

/**
 * Fixed-window counters stored in PostgreSQL (shared across app instances).
 * Scope strings are digested so raw usernames/IPs are not stored in the bucket table.
 */
export interface Bucket {
  count: number;
  retryAfterSeconds: number;
}

function window(deps: Pick<Deps, 'clock'>, windowMs: number) {
  const now = deps.clock.now().getTime();
  const start = Math.floor(now / windowMs) * windowMs;
  return { start: new Date(start), end: new Date(start + windowMs), retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
}

export async function consume(deps: Pick<Deps, 'clock' | 'crypto' | 'prisma'>, scope: string, windowMs: number): Promise<Bucket> {
  const w = window(deps, windowMs);
  const digest = deps.crypto.digest('rate-limit', scope);
  const rows = await deps.prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("scopeDigest", "windowStart", "count", "expiresAt")
    VALUES (${digest}, ${w.start}, 1, ${w.end})
    ON CONFLICT ("scopeDigest", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  return { count: Number(rows[0]!.count), retryAfterSeconds: w.retryAfterSeconds };
}

export async function peek(deps: Pick<Deps, 'clock' | 'crypto' | 'prisma'>, scope: string, windowMs: number): Promise<Bucket> {
  const w = window(deps, windowMs);
  const row = await deps.prisma.rateLimitBucket.findUnique({
    where: { scopeDigest_windowStart: { scopeDigest: deps.crypto.digest('rate-limit', scope), windowStart: w.start } },
  });
  return { count: row?.count ?? 0, retryAfterSeconds: w.retryAfterSeconds };
}

/** Counts this attempt and throws 429 once the limit is exceeded. */
export async function enforce(deps: Pick<Deps, 'clock' | 'crypto' | 'prisma'>, scope: string, limit: number, windowMs: number): Promise<void> {
  const b = await consume(deps, scope, windowMs);
  if (b.count > limit) throw rateLimited(b.retryAfterSeconds);
}
