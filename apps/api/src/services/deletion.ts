import type { Prisma } from '@prisma/client';
import type { Deps } from '../deps.js';
import { notFound } from '../lib/errors.js';
import { revokeAllSessions } from '../auth/session.js';
import { audit } from './audit.js';
import { POLICY_VERSION, type SubjectAuthority } from './people.js';

/**
 * Deletion takes effect immediately: sessions and grants (both directions) are revoked,
 * routing secrets stop working, open requests close and the person disappears from every
 * view. Content is purged in the same transaction, so it never waits for the background job
 * (which does not run while single-process hosting sleeps). A tombstone records only
 * identifiers so a restored backup can re-apply the deletion.
 */
export async function deletePerson(deps: Deps, auth: SubjectAuthority, reason: 'SELF' | 'ASSISTED'): Promise<void> {
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; accountId: string | null; deletedAt: Date | null }[]>`
      SELECT "id", "accountId", "deletedAt" FROM "Person" WHERE "id" = ${auth.personId}::uuid FOR UPDATE`;
    const person = rows[0];
    if (!person || person.deletedAt) throw notFound();
    await applyDeletion(deps, tx, person.id, person.accountId, now);
    await tx.consentRecord.create({
      data: {
        personId: person.id,
        actorAccountId: auth.actorAccountId,
        caseId: auth.caseId ?? null,
        assistanceSessionId: auth.assistanceSessionId ?? null,
        action: 'DELETE',
        statedAt: now,
        recordedAt: now,
        policyVersion: POLICY_VERSION,
      },
    });
    await purgePerson(deps, tx, person.id, person.accountId, now);
    await tx.deletionTombstone.create({
      data: { personRef: person.id, accountRef: person.accountId, deletedAt: now, purgeAfter: now, purgedAt: now, reason },
    });
    await audit(tx, {
      actorAccountId: auth.actorAccountId,
      action: 'person.delete',
      objectType: 'Person',
      objectId: person.id,
      authorityType: auth.authorityType,
      authorityId: auth.caseId ?? null,
      result: 'SUCCEEDED',
      at: now,
    });
  });
}

/** Idempotent; also used when replaying the deletion ledger onto a restored backup. */
export async function applyDeletion(deps: Pick<Deps, 'clock'>, tx: Prisma.TransactionClient, personId: string, accountId: string | null, now: Date) {
  await tx.person.updateMany({ where: { id: personId, deletedAt: null }, data: { deletedAt: now, requestMode: 'CLOSED', version: { increment: 1 } } });
  if (accountId) {
    await tx.account.updateMany({ where: { id: accountId, deletedAt: null }, data: { state: 'DELETED', deletedAt: now } });
    await revokeAllSessions(deps, tx, accountId);
  }
  await tx.sharingGrant.updateMany({
    where: { OR: [{ subjectPersonId: personId }, { recipientPersonId: personId }], revokedAt: null },
    data: { revokedAt: now, revokedReason: 'DELETED' },
  });
  await tx.contactCode.updateMany({ where: { personId, revokedAt: null }, data: { revokedAt: now } });
  await tx.assistanceCredential.updateMany({ where: { personId, revokedAt: null }, data: { revokedAt: now } });
  const openRequests = await tx.reunionRequest.findMany({
    where: { requesterPersonId: personId, withdrawnAt: null, internalState: { not: 'RESPONDED' } },
    select: { id: true },
  });
  await tx.reunionRequest.updateMany({
    where: { id: { in: openRequests.map((r) => r.id) } },
    data: { internalState: 'WITHDRAWN', withdrawnAt: now, closedAt: now, codeDigest: null },
  });
  await tx.requestRoute.updateMany({ where: { requestId: { in: openRequests.map((r) => r.id) }, endedAt: null }, data: { state: 'ENDED', endedAt: now } });
  const cases = await tx.assistanceCase.findMany({ where: { personId, state: 'ACTIVE' }, select: { id: true } });
  for (const c of cases) {
    await tx.assistanceCase.update({ where: { id: c.id }, data: { state: 'CLOSED', closedAt: now } });
    await tx.caseAssignment.updateMany({ where: { caseId: c.id, endsAt: null }, data: { endsAt: now, endedReason: 'PERSON_DELETED' } });
    await tx.assistanceSession.updateMany({ where: { caseId: c.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.caseTransfer.updateMany({ where: { caseId: c.id, state: 'PROPOSED' }, data: { state: 'CANCELLED', decidedAt: now } });
  }
}

/**
 * Removes the deleted person's content: profile text, check-ins, messages, request text,
 * grants, codes, credentials and notifications. Counterparts keep a neutral, empty
 * "response unavailable" record. Consent/audit metadata (no content) is kept for its own
 * retention window.
 */
export async function purgePerson(deps: Pick<Deps, 'clock'>, tx: Prisma.TransactionClient, personId: string, accountId: string | null, now: Date) {
  await tx.sharingGrant.deleteMany({ where: { OR: [{ subjectPersonId: personId }, { recipientPersonId: personId }] } });
  await tx.response.updateMany({
    where: { subjectPersonId: personId, purgedAt: null },
    data: { encryptedMessage: null, checkInId: null, sharedAlias: '', purgedAt: now },
  });
  await tx.checkIn.deleteMany({ where: { personId } });
  await tx.reunionRequest.updateMany({
    where: { requesterPersonId: personId },
    data: { encryptedIntroduction: null, encryptedClues: null, requesterAliasSnapshot: '', textPurgedAt: now, codeDigest: null },
  });
  await tx.contactCode.deleteMany({ where: { personId } });
  await tx.assistanceCredential.deleteMany({ where: { personId } });
  const cases = await tx.assistanceCase.findMany({ where: { personId }, select: { id: true } });
  await tx.notification.deleteMany({ where: { assistedCaseId: { in: cases.map((c) => c.id) } } });
  if (accountId) {
    await tx.notification.deleteMany({ where: { recipientAccountId: accountId } });
    await tx.session.deleteMany({ where: { accountId } });
    await tx.recoveryCredential.deleteMany({ where: { accountId } });
    await tx.staffMfa.deleteMany({ where: { accountId } });
  }
  await tx.person.update({ where: { id: personId }, data: { alias: '', encryptedMatchingClue: null, purgedAt: now } });
}
