import type { Prisma } from '@prisma/client';
import type { Deps } from '../deps.js';
import { audit } from '../services/audit.js';
import { notifyAccount, notifyPerson } from '../services/notifications.js';

const LEASE_MS = 30_000;
export const MAX_ATTEMPTS = 5;

/** Reference-only payloads: identifiers, never message text, clues or locations. */
export type JobPayload =
  | { kind: 'request.resolve'; requestId: string }
  | { kind: 'response.notify'; responseId: string }
  | { kind: 'request.notifyRecipient'; requestId: string }
  | { kind: 'lead.requested'; requestId: string; askId: string }
  | { kind: 'transfer.notify'; transferId: string };

export async function enqueue(deps: Pick<Deps, 'clock'>, tx: Prisma.TransactionClient, payload: JobPayload, eventKey: string): Promise<void> {
  const now = deps.clock.now();
  await tx.outboxJob.createMany({
    data: [{ eventKey, kind: payload.kind, referencePayload: payload, availableAt: now, createdAt: now }],
    skipDuplicates: true,
  });
}

interface ClaimedJob {
  id: string;
  kind: string;
  referencePayload: JobPayload;
  attempts: number;
}

function isSimulatedCrash(e: unknown): boolean {
  return e instanceof Error && e.name === 'SimulatedCrash';
}

/**
 * Claims up to `limit` due jobs with a lease (FOR UPDATE SKIP LOCKED), processes each and
 * marks it done. A crash leaves the lease to expire so another worker retries. Handlers
 * reload current authority and are idempotent (notifications dedupe by event key).
 */
export async function processDueJobs(deps: Deps, limit = 50, concurrency = 8): Promise<number> {
  const now = deps.clock.now();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const jobs = await deps.prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "OutboxJob" SET "leaseUntil" = ${leaseUntil}, "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "OutboxJob"
      WHERE "state" = 'PENDING' AND "availableAt" <= ${now} AND ("leaseUntil" IS NULL OR "leaseUntil" < ${now})
      ORDER BY "availableAt" LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    RETURNING "id", "kind", "referencePayload", "attempts"`;
  // Jobs touch different rows and each handler takes its own row locks, so a small pool is safe.
  let next = 0;
  let crash: unknown = null;
  const runOne = async (job: ClaimedJob) => {
    try {
      await handle(deps, job);
      await deps.prisma.outboxJob.update({ where: { id: job.id }, data: { state: 'DONE', completedAt: deps.clock.now(), leaseUntil: null } });
    } catch (e) {
      if (isSimulatedCrash(e)) throw e;
      const failed = job.attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(15 * 60_000, 2 ** job.attempts * 5_000);
      await deps.prisma.outboxJob.update({
        where: { id: job.id },
        data: {
          state: failed ? 'FAILED' : 'PENDING',
          leaseUntil: null,
          availableAt: new Date(deps.clock.now().getTime() + backoffMs),
          lastErrorCode: e instanceof Error ? e.name.slice(0, 60) : 'error',
        },
      });
      deps.logger.warn('job_failed', { jobId: job.id, kind: job.kind, attempts: job.attempts, terminal: failed });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length && !crash) {
        const job = jobs[next++]!;
        try {
          await runOne(job);
        } catch (e) {
          crash = e; // simulated process crash: stop like a dead worker would
        }
      }
    }),
  );
  if (crash) throw crash;
  return jobs.length;
}

async function handle(deps: Deps, job: ClaimedJob): Promise<void> {
  const p = job.referencePayload;
  switch (p.kind) {
    case 'request.resolve':
      await resolveCodeRequest(deps, p.requestId);
      break;
    case 'response.notify':
      await notifyResponse(deps, p.responseId);
      break;
    case 'request.notifyRecipient':
      await notifyProposedRecipient(deps, p.requestId);
      break;
    case 'lead.requested':
      await notifyLeadRequested(deps, p.requestId, p.askId);
      break;
    case 'transfer.notify':
      await notifyTransfer(deps, p.transferId);
      break;
    default:
      throw new Error('UnknownJobKind');
  }
  await deps.hooks?.afterNotificationInsert?.(job.id);
}

/**
 * Resolves a contact code privately. Unknown, rotated, closed, blocked, restricted or
 * self-addressed targets all become UNRESOLVED, which the requester sees exactly like a
 * pending request. The code digest is cleared either way.
 */
async function resolveCodeRequest(deps: Deps, requestId: string): Promise<void> {
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; internalState: string; codeDigest: string | null; requesterPersonId: string; incidentId: string; withdrawnAt: Date | null; expiresAt: Date }[]>`
      SELECT "id", "internalState"::text AS "internalState", "codeDigest", "requesterPersonId", "incidentId", "withdrawnAt", "expiresAt"
      FROM "ReunionRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
    const req = rows[0];
    if (!req || req.internalState !== 'SUBMITTED') return;
    const code = req.codeDigest ? await tx.contactCode.findUnique({ where: { digest: req.codeDigest }, include: { person: true } }) : null;
    const target = code && !code.revokedAt ? code.person : null;
    let deliverable =
      !!target &&
      !target.deletedAt &&
      !target.restrictedReferral &&
      target.requestMode !== 'CLOSED' &&
      target.incidentId === req.incidentId &&
      target.id !== req.requesterPersonId &&
      !req.withdrawnAt &&
      req.expiresAt > now;
    if (deliverable) {
      const blocked = await tx.block.findUnique({ where: { subjectPersonId_blockedPersonId: { subjectPersonId: target!.id, blockedPersonId: req.requesterPersonId } } });
      if (blocked) deliverable = false;
    }
    if (!deliverable) {
      await tx.reunionRequest.update({ where: { id: requestId }, data: { internalState: 'UNRESOLVED', codeDigest: null } });
      await audit(tx, { actorAccountId: null, action: 'request.resolve', objectType: 'ReunionRequest', objectId: requestId, authorityType: 'WORKER', result: 'SUPPRESSED', at: now });
      return;
    }
    await tx.reunionRequest.update({
      where: { id: requestId },
      data: { internalState: 'AWAITING_DECISION', recipientPersonId: target!.id, deliveredAt: now, codeDigest: null, version: { increment: 1 } },
    });
    await notifyPerson(deps, tx, target!.id, 'REQUEST_RECEIVED', { type: 'ReunionRequest', id: requestId }, `request.received:${requestId}`);
    await audit(tx, { actorAccountId: null, action: 'request.resolve', objectType: 'ReunionRequest', objectId: requestId, authorityType: 'WORKER', result: 'SUCCEEDED', at: now });
  });
}

/** Rechecks the grant at delivery time; a revoked/expired grant or block suppresses the notice. */
async function notifyResponse(deps: Deps, responseId: string): Promise<void> {
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const grant = await tx.sharingGrant.findUnique({ where: { responseId } });
    if (!grant || grant.revokedAt || grant.expiresAt <= now) {
      await audit(tx, { actorAccountId: null, action: 'response.notify', objectType: 'Response', objectId: responseId, authorityType: 'WORKER', result: 'SUPPRESSED', at: now });
      return;
    }
    await notifyPerson(deps, tx, grant.recipientPersonId, 'RESPONSE_AVAILABLE', { type: 'ReunionRequest', id: grant.requestId }, `response.available:${responseId}`);
  });
}

/** Staff-proposed recipient: deliver only if the request is still awaiting this person's decision. */
async function notifyProposedRecipient(deps: Deps, requestId: string): Promise<void> {
  await deps.prisma.$transaction(async (tx) => {
    const req = await tx.reunionRequest.findUnique({ where: { id: requestId } });
    if (!req || req.internalState !== 'AWAITING_DECISION' || !req.recipientPersonId) return;
    const blocked = await tx.block.findUnique({ where: { subjectPersonId_blockedPersonId: { subjectPersonId: req.recipientPersonId, blockedPersonId: req.requesterPersonId } } });
    if (blocked) return;
    await notifyPerson(deps, tx, req.recipientPersonId, 'REQUEST_RECEIVED', { type: 'ReunionRequest', id: requestId }, `request.received:${requestId}`);
  });
}

async function notifyLeadRequested(deps: Deps, requestId: string, askId: string): Promise<void> {
  await deps.prisma.$transaction(async (tx) => {
    const req = await tx.reunionRequest.findUnique({ where: { id: requestId } });
    if (!req || req.withdrawnAt || req.internalState === 'RESPONDED') return;
    await notifyPerson(deps, tx, req.requesterPersonId, 'LEAD_REQUESTED', { type: 'ReunionRequest', id: requestId }, `lead.requested:${askId}`);
  });
}

async function notifyTransfer(deps: Deps, transferId: string): Promise<void> {
  await deps.prisma.$transaction(async (tx) => {
    const t = await tx.caseTransfer.findUnique({ where: { id: transferId } });
    if (!t || t.state !== 'PROPOSED') return;
    const coordinators = await tx.staffMembership.findMany({ where: { shelterId: t.toShelterId, role: 'COORDINATOR', state: 'ACTIVE' } });
    for (const c of coordinators) {
      await notifyAccount(deps, tx, c.accountId, 'TRANSFER_PENDING', { type: 'CaseTransfer', id: transferId }, `transfer.pending:${transferId}`);
    }
  });
}
