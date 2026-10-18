import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Deps } from '../deps.js';
import { conflict } from '../lib/errors.js';
import { DAY } from '../lib/clock.js';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export interface IdempotencySpec {
  actorAccountId: string;
  operation: string;
  /** Intended subject (person, case, request...) so one key cannot be replayed against another subject. */
  subjectKey: string;
  key: string;
  payload: unknown;
}

export interface IdempotentResult<T> {
  outcomeId: string;
  replayed: boolean;
  /** Values only available to the original call (e.g. one-time secrets). Never stored. */
  extra?: T;
}

/** True when this exact key already produced a saved outcome (a retry, not a new write). */
export async function isCompletedRetry(deps: Deps, spec: Omit<IdempotencySpec, 'payload'>): Promise<boolean> {
  const existing = await deps.prisma.idempotencyRecord.findUnique({
    where: {
      actorAccountId_operation_subjectKey_keyDigest: {
        actorAccountId: spec.actorAccountId,
        operation: spec.operation,
        subjectKey: spec.subjectKey,
        keyDigest: deps.crypto.digest('idempotency', spec.key),
      },
    },
  });
  return !!existing?.outcomeId;
}

/**
 * Runs `work` exactly once per (actor, operation, subject, key). Concurrent duplicates
 * wait on the unique index, then read the committed outcome reference. The stored
 * outcome is a reference only; callers rebuild responses under current authorization.
 */
export async function idempotent<T>(
  deps: Deps,
  spec: IdempotencySpec,
  work: (tx: Prisma.TransactionClient) => Promise<{ outcomeType: string; outcomeId: string; extra?: T }>,
): Promise<IdempotentResult<T>> {
  const keyDigest = deps.crypto.digest('idempotency', spec.key);
  const payloadDigest = deps.crypto.digest('payload', `${spec.operation}\u0000${stableStringify(spec.payload)}`);
  const now = deps.clock.now();
  return deps.prisma.$transaction(
    async (tx) => {
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "IdempotencyRecord" ("id", "actorAccountId", "operation", "subjectKey", "keyDigest", "payloadDigest", "createdAt", "expiresAt")
        VALUES (${randomUUID()}::uuid, ${spec.actorAccountId}::uuid, ${spec.operation}, ${spec.subjectKey}, ${keyDigest}, ${payloadDigest}, ${now}, ${new Date(now.getTime() + DAY)})
        ON CONFLICT ("actorAccountId", "operation", "subjectKey", "keyDigest") DO NOTHING
        RETURNING "id"`;
      if (inserted.length === 0) {
        const existing = await tx.idempotencyRecord.findUnique({
          where: {
            actorAccountId_operation_subjectKey_keyDigest: {
              actorAccountId: spec.actorAccountId,
              operation: spec.operation,
              subjectKey: spec.subjectKey,
              keyDigest,
            },
          },
        });
        if (!existing || existing.payloadDigest !== payloadDigest || !existing.outcomeId) {
          throw conflict('This retry key was already used for a different submission. Start a new submission.');
        }
        return { outcomeId: existing.outcomeId, replayed: true };
      }
      const result = await work(tx);
      await tx.idempotencyRecord.update({
        where: { id: inserted[0]!.id },
        data: { outcomeType: result.outcomeType, outcomeId: result.outcomeId },
      });
      return { outcomeId: result.outcomeId, replayed: false, extra: result.extra };
    },
    { timeout: 15_000, maxWait: 15_000 },
  );
}
