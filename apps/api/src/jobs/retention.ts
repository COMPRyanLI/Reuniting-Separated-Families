import type { Deps } from '../deps.js';
import { DAY, HOUR } from '../lib/clock.js';
import { audit } from '../services/audit.js';
import { applyDeletion, purgePerson } from '../services/deletion.js';
import { notifyAccount } from '../services/notifications.js';
import { REVIEW_AFTER_MS } from '../services/cases.js';

/**
 * Prototype retention policy (docs/security-and-permissions.md §7). Configurable product
 * choices, not legal conclusions. Every step is idempotent and uses the injected clock.
 */
export const RETENTION = {
  unansweredTextPurgeAfterClosure: 30 * DAY,
  closedCaseContentPurge: 30 * DAY,
  credentialArtifacts: DAY,
  completedJobs: 7 * DAY,
  notifications: 30 * DAY,
  audit: 90 * DAY,
} as const;

export interface RetentionSummary {
  requestsExpired: number;
  requestTextPurged: number;
  personsPurged: number;
  closedCasesPurged: number;
  reviewNotices: number;
  sessionsDeleted: number;
  credentialsDeleted: number;
  jobsDeleted: number;
  notificationsDeleted: number;
  auditDeleted: number;
}

export async function runRetention(deps: Deps): Promise<RetentionSummary> {
  const now = deps.clock.now();
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const p = deps.prisma;

  // 1. Unanswered requests expire at their original deadline. closedAt is the deadline itself,
  //    so hidden decline/block/no-match outcomes cannot be inferred from closure times.
  const due = await p.reunionRequest.findMany({
    where: { expiresAt: { lte: now }, withdrawnAt: null, internalState: { in: ['SUBMITTED', 'ROUTING', 'UNRESOLVED', 'AWAITING_DECISION', 'DECLINED', 'BLOCKED'] } },
    select: { id: true, expiresAt: true },
  });
  for (const r of due) {
    await p.$transaction([
      p.reunionRequest.update({ where: { id: r.id }, data: { internalState: 'EXPIRED', closedAt: r.expiresAt, codeDigest: null } }),
      p.requestRoute.updateMany({ where: { requestId: r.id, endedAt: null }, data: { state: 'ENDED', endedAt: now } }),
    ]);
  }

  // 2. Personal text of closed, unanswered requests: purged 30 days after closure.
  const textPurge = await p.reunionRequest.updateMany({
    where: { internalState: { in: ['EXPIRED', 'WITHDRAWN'] }, closedAt: { lte: ago(RETENTION.unansweredTextPurgeAfterClosure) }, textPurgedAt: null },
    data: { encryptedIntroduction: null, encryptedClues: null, textPurgedAt: now },
  });

  // 3. Deleted people: deletion purges at once; this catches tombstones recorded without a purge
  //    (earlier versions of this service).
  const tombstones = await p.deletionTombstone.findMany({ where: { purgedAt: null, purgeAfter: { lte: now } }, take: 200 });
  for (const t of tombstones) {
    await p.$transaction(async (tx) => {
      await purgePerson(deps, tx, t.personRef, t.accountRef, now);
      await tx.deletionTombstone.update({ where: { id: t.id }, data: { purgedAt: now } });
      await audit(tx, { actorAccountId: null, action: 'retention.purgePerson', objectType: 'Person', objectId: t.personRef, authorityType: 'RETENTION', result: 'SUCCEEDED', at: now });
    });
  }

  // 4. Assisted people whose case closed 30+ days ago (no account of their own): content purged.
  const closedCases = await p.assistanceCase.findMany({
    where: { state: 'CLOSED', closedAt: { lte: ago(RETENTION.closedCaseContentPurge) }, person: { accountId: null, purgedAt: null } },
    select: { id: true, personId: true },
    take: 200,
  });
  for (const c of closedCases) {
    const stillActive = await p.assistanceCase.count({ where: { personId: c.personId, state: 'ACTIVE' } });
    if (stillActive > 0) continue;
    await p.$transaction(async (tx) => {
      // Same immediate effects as a requested deletion (grants, codes, open requests, routes), then purge.
      await applyDeletion(deps, tx, c.personId, null, now);
      await tx.deletionTombstone.create({ data: { personRef: c.personId, accountRef: null, deletedAt: now, purgeAfter: now, purgedAt: now, reason: 'CASE_CLOSED_RETENTION' } });
      await purgePerson(deps, tx, c.personId, null, now);
    });
  }

  // 5. Inactive active cases: a review notice for the shelter's coordinators (once per inactivity period).
  let reviewNotices = 0;
  const active = await p.assistanceCase.findMany({ where: { state: 'ACTIVE' }, select: { id: true, shelterId: true, lastActivityAt: true, lastReviewedAt: true, reviewExtendedUntil: true } });
  for (const c of active) {
    if (c.reviewExtendedUntil && c.reviewExtendedUntil > now) continue;
    const anchor = new Date(Math.max(c.lastActivityAt.getTime(), c.lastReviewedAt?.getTime() ?? 0));
    if (now.getTime() - anchor.getTime() <= REVIEW_AFTER_MS) continue;
    const coordinators = await p.staffMembership.findMany({ where: { shelterId: c.shelterId, role: 'COORDINATOR', state: 'ACTIVE' } });
    await p.$transaction(async (tx) => {
      for (const m of coordinators) {
        await notifyAccount(deps, tx, m.accountId, 'CASE_REVIEW_DUE', { type: 'AssistanceCase', id: c.id }, `case.review:${c.id}:${anchor.toISOString()}`);
      }
    });
    reviewNotices += coordinators.length;
  }

  // 6. Credential artifacts: expired/revoked sessions, used/revoked recovery codes and old
  //    assistance sessions are removed after 24 hours.
  const cutoff = ago(RETENTION.credentialArtifacts);
  const sessions = await p.session.deleteMany({
    where: { OR: [{ revokedAt: { lte: cutoff } }, { expiresAt: { lte: cutoff } }, { lastUserActivityAt: { lte: ago(RETENTION.credentialArtifacts + 12 * HOUR) } }] },
  });
  const recovery = await p.recoveryCredential.deleteMany({ where: { OR: [{ usedAt: { lte: cutoff } }, { revokedAt: { lte: cutoff } }] } });
  // Assistance sessions referenced by a consent record stay as evidence of the verification behind it.
  const assistanceCount = await p.$executeRaw`
    DELETE FROM "AssistanceSession" s
    WHERE (s."revokedAt" <= ${cutoff} OR s."expiresAt" <= ${cutoff})
      AND NOT EXISTS (SELECT 1 FROM "ConsentRecord" c WHERE c."assistanceSessionId" = s."id")`;
  await p.idempotencyRecord.deleteMany({ where: { expiresAt: { lte: now } } });
  await p.rateLimitBucket.deleteMany({ where: { expiresAt: { lte: now } } });

  // 7. Completed jobs after 7 days; notifications after 30 days; audit metadata after 90 days.
  const jobs = await p.outboxJob.deleteMany({ where: { state: 'DONE', completedAt: { lte: ago(RETENTION.completedJobs) } } });
  const notifications = await p.notification.deleteMany({ where: { createdAt: { lte: ago(RETENTION.notifications) } } });
  const auditRows = await p.auditEvent.deleteMany({ where: { occurredAt: { lte: ago(RETENTION.audit) } } });

  const summary: RetentionSummary = {
    requestsExpired: due.length,
    requestTextPurged: textPurge.count,
    personsPurged: tombstones.length,
    closedCasesPurged: closedCases.length,
    reviewNotices,
    sessionsDeleted: sessions.count,
    credentialsDeleted: recovery.count + assistanceCount,
    jobsDeleted: jobs.count,
    notificationsDeleted: notifications.count,
    auditDeleted: auditRows.count,
  };
  deps.logger.info('retention_run', { ...summary });
  return summary;
}
