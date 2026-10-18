import type { Deps } from '../deps.js';
import { consume, peek } from '../auth/rateLimit.js';
import { AppError, conflict, forbidden, notFound, rateLimited, validation } from '../lib/errors.js';
import { MINUTE } from '../lib/clock.js';
import { isWellFormedSecret, normalizeSecret } from '../lib/secrets.js';
import { enqueue } from '../jobs/outbox.js';
import { coordinatorMembership, type CaseScope } from '../policy/case.js';
import type { StaffContext } from '../policy/staff.js';
import { audit } from './audit.js';
import { POLICY_VERSION } from './people.js';

/**
 * Proposed by verified staff at the source shelter with the person's recorded choice.
 * The destination sees only the reference and alias until it accepts.
 */
export async function proposeTransfer(deps: Deps, staff: StaffContext, scope: CaseScope, toShelterId: string) {
  const session = scope.session!;
  if (toShelterId === scope.kase.shelterId) throw validation([{ path: 'toShelterId', message: 'Choose a different shelter.' }]);
  const destination = await deps.prisma.shelter.findFirst({ where: { id: toShelterId, incidentId: scope.kase.incidentId, state: 'OPEN' } });
  if (!destination) throw validation([{ path: 'toShelterId', message: 'Choose a participating shelter.' }]);
  const person = await deps.prisma.person.findUniqueOrThrow({ where: { id: scope.kase.personId } });
  if (person.restrictedReferral) throw forbidden('Restricted referrals are handed over through the referral process, not this transfer.');
  const now = deps.clock.now();
  try {
    return await deps.prisma.$transaction(async (tx) => {
      const consent = await tx.consentRecord.create({
        data: {
          personId: scope.kase.personId,
          actorAccountId: staff.accountId,
          caseId: scope.kase.id,
          assistanceSessionId: session.id,
          action: 'TRANSFER',
          resourceId: toShelterId,
          statedAt: now,
          recordedAt: now,
          policyVersion: POLICY_VERSION,
        },
      });
      const t = await tx.caseTransfer.create({
        data: {
          caseId: scope.kase.id,
          incidentId: scope.kase.incidentId,
          fromShelterId: scope.kase.shelterId,
          toShelterId,
          consentId: consent.id,
          proposedByAccountId: staff.accountId,
          createdAt: now,
        },
      });
      await enqueue(deps, tx, { kind: 'transfer.notify', transferId: t.id }, `transfer.notify:${t.id}`);
      await audit(tx, { actorAccountId: staff.accountId, action: 'case.transfer.propose', objectType: 'CaseTransfer', objectId: t.id, authorityType: 'ASSIGNMENT', authorityId: scope.assignment.id, result: 'SUCCEEDED', at: now });
      return { transferId: t.id };
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw conflict('A transfer for this case is already waiting.');
    throw e;
  }
}

export async function incomingTransfers(deps: Deps, staff: StaffContext) {
  const shelters = staff.memberships.filter((m) => m.role === 'COORDINATOR' && m.shelterId).map((m) => m.shelterId!);
  if (shelters.length === 0) return [];
  const rows = await deps.prisma.caseTransfer.findMany({ where: { toShelterId: { in: shelters }, state: 'PROPOSED' }, orderBy: { createdAt: 'asc' } });
  const cases = await deps.prisma.assistanceCase.findMany({ where: { id: { in: rows.map((r) => r.caseId) } }, include: { person: { select: { alias: true } } } });
  const fromShelters = await deps.prisma.shelter.findMany({ where: { id: { in: rows.map((r) => r.fromShelterId) } }, select: { id: true, name: true } });
  return rows.map((t) => {
    const c = cases.find((x) => x.id === t.caseId)!;
    return {
      transferId: t.id,
      caseReference: c.reference,
      alias: c.person.alias,
      fromShelterName: fromShelters.find((s) => s.id === t.fromShelterId)?.name ?? '',
      toShelterId: t.toShelterId,
      createdAt: t.createdAt.toISOString(),
    };
  });
}

/**
 * Destination coordinator accepts after verifying the person's assistance secret, and
 * names the destination worker. In one transaction (transfer row locked) the case moves,
 * every source assignment ends, assistance sessions are revoked and the new assignment
 * starts. A second concurrent acceptance sees the transfer no longer PROPOSED.
 */
export async function acceptTransfer(deps: Deps, staff: StaffContext, transferId: string, input: { assistanceSecret: string; membershipId: string }) {
  const transfer = await deps.prisma.caseTransfer.findUnique({ where: { id: transferId } });
  if (!transfer) throw notFound();
  const coordinator = coordinatorMembership(staff, transfer.toShelterId, transfer.incidentId);
  if (!coordinator) throw notFound();
  // Decided transfers are refused before the secret is looked at, so they cannot confirm one.
  if (transfer.state !== 'PROPOSED') throw conflict('This transfer was already decided.');
  const failScope = `transfer-verify:${staff.accountId}:${transferId}`;
  const failures = await peek(deps, failScope, 15 * MINUTE);
  if (failures.count >= deps.config.limits.assistVerify) throw rateLimited(failures.retryAfterSeconds);
  const kase = await deps.prisma.assistanceCase.findUniqueOrThrow({ where: { id: transfer.caseId } });
  const credential = isWellFormedSecret(input.assistanceSecret)
    ? await deps.prisma.assistanceCredential.findFirst({
        where: { personId: kase.personId, revokedAt: null, digest: deps.crypto.digest('assistance', normalizeSecret(input.assistanceSecret)) },
      })
    : null;
  if (!credential) {
    await consume(deps, failScope, 15 * MINUTE);
    throw new AppError(403, 'FORBIDDEN', 'The assistance secret was not accepted.');
  }
  const target = await deps.prisma.staffMembership.findUnique({ where: { id: input.membershipId } });
  if (!target || target.state !== 'ACTIVE' || target.shelterId !== transfer.toShelterId || target.role === 'OPERATOR') {
    throw validation([{ path: 'membershipId', message: 'Choose an active staff member at your shelter.' }]);
  }
  if (target.accountId === staff.accountId) throw forbidden('Coordinators cannot assign cases to themselves.');
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ state: string }[]>`SELECT "state"::text AS "state" FROM "CaseTransfer" WHERE "id" = ${transferId}::uuid FOR UPDATE`;
    if (locked[0]?.state !== 'PROPOSED') throw conflict('This transfer was already decided.');
    const caseRows = await tx.$queryRaw<{ state: string; shelterId: string }[]>`
      SELECT "state"::text AS "state", "shelterId" FROM "AssistanceCase" WHERE "id" = ${transfer.caseId}::uuid FOR UPDATE`;
    if (caseRows[0]?.state !== 'ACTIVE' || caseRows[0].shelterId !== transfer.fromShelterId) throw conflict('This case changed. Refresh and try again.');
    await tx.caseAssignment.updateMany({ where: { caseId: transfer.caseId, endsAt: null }, data: { endsAt: now, endedReason: 'TRANSFERRED' } });
    await tx.assistanceSession.updateMany({ where: { caseId: transfer.caseId, revokedAt: null }, data: { revokedAt: now } });
    await tx.assistanceCase.update({ where: { id: transfer.caseId }, data: { shelterId: transfer.toShelterId, lastActivityAt: now, version: { increment: 1 } } });
    await tx.caseAssignment.create({
      data: {
        caseId: transfer.caseId,
        incidentId: transfer.incidentId,
        membershipId: target.id,
        staffAccountId: target.accountId,
        purposes: ['ASSIST'],
        startsAt: now,
        assignedByAccountId: staff.accountId,
      },
    });
    await tx.caseTransfer.update({ where: { id: transferId }, data: { state: 'ACCEPTED', decidedByAccountId: staff.accountId, decidedAt: now, version: { increment: 1 } } });
    await audit(tx, { actorAccountId: staff.accountId, action: 'case.transfer.accept', objectType: 'CaseTransfer', objectId: transferId, authorityType: 'COORDINATOR', authorityId: coordinator.id, result: 'SUCCEEDED', at: now });
  });
}

export async function cancelTransfer(deps: Deps, staff: StaffContext, transferId: string) {
  const transfer = await deps.prisma.caseTransfer.findUnique({ where: { id: transferId } });
  if (!transfer) throw notFound();
  const allowed = transfer.proposedByAccountId === staff.accountId || coordinatorMembership(staff, transfer.fromShelterId, transfer.incidentId);
  if (!allowed) throw notFound();
  const updated = await deps.prisma.caseTransfer.updateMany({ where: { id: transferId, state: 'PROPOSED' }, data: { state: 'CANCELLED', decidedByAccountId: staff.accountId, decidedAt: deps.clock.now() } });
  if (updated.count !== 1) throw conflict('This transfer was already decided.');
}
