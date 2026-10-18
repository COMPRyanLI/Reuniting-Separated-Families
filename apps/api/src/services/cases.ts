import { randomUUID } from 'node:crypto';
import type { IntakeInput } from '@rf/contracts';
import type { Deps } from '../deps.js';
import { consume, enforce, peek } from '../auth/rateLimit.js';
import { AppError, conflict, forbidden, notFound, rateLimited, validation } from '../lib/errors.js';
import { HOUR, MINUTE } from '../lib/clock.js';
import { generateCaseReference, generateSecret, isWellFormedSecret, normalizeSecret } from '../lib/secrets.js';
import { coordinatorMembership, loadAssignedCase, type CaseScope } from '../policy/case.js';
import type { StaffContext } from '../policy/staff.js';
import { audit } from './audit.js';
import { createCheckIn, toOwnCheckInDto } from './checkins.js';
import { idempotent, isCompletedRetry } from './idempotency.js';
import { POLICY_VERSION, type SubjectAuthority } from './people.js';
import { placeMaps } from './places.js';

export const ASSISTANCE_SESSION_MS = 10 * MINUTE;
export const REFERRAL_GUIDANCE =
  'Restricted referral: do not share location or contact details through this site. Hand over to the designated safeguarding referral process. This demo does not decide guardianship.';

/**
 * The shelter where the intake happens. Staff with one shelter use it implicitly; staff with
 * several must name one of their own shelters. Never another shelter, never a silent pick.
 */
function intakeMembership(staff: StaffContext, shelterId: string | undefined) {
  const local = staff.memberships.filter((x) => x.role !== 'OPERATOR' && x.shelterId);
  if (local.length === 0) throw forbidden('Only shelter staff can record an intake.');
  if (shelterId) {
    const m = local.find((x) => x.shelterId === shelterId);
    if (!m) throw validation([{ path: 'shelterId', message: 'You can only record intakes at a shelter where you work.' }]);
    return m;
  }
  if (new Set(local.map((x) => x.shelterId)).size > 1) {
    throw validation([{ path: 'shelterId', message: 'Choose which of your shelters this intake is at.' }]);
  }
  return local[0]!;
}

/**
 * Local assisted intake: person (no account), case at the worker's own shelter, the
 * worker's initial assignment, witnessed consent, a separate assistance secret and
 * optionally a first check-in, all in one transaction.
 */
export async function intake(deps: Deps, staff: StaffContext, input: IntakeInput, key: string) {
  const membership = intakeMembership(staff, input.shelterId);
  const restricted = input.restrictedReferral;
  if (restricted) {
    const bad: { path: string; message: string }[] = [];
    if (input.checkIn) bad.push({ path: 'checkIn', message: 'Restricted referrals cannot include a check-in.' });
    if (input.requestMode && input.requestMode !== 'CLOSED') bad.push({ path: 'requestMode', message: 'Restricted referrals are never available for requests.' });
    if (input.matchingClue) bad.push({ path: 'matchingClue', message: 'Restricted referrals cannot be matched.' });
    if (input.issueContactCode) bad.push({ path: 'issueContactCode', message: 'Restricted referrals do not get contact codes.' });
    if (bad.length) throw validation(bad);
  }
  const requestMode = restricted ? 'CLOSED' : (input.requestMode ?? 'CODE_ONLY');
  if (input.matchingClue && requestMode !== 'ASSISTED') {
    throw validation([{ path: 'matchingClue', message: 'A matching clue is only used when the person opts into assisted matching.' }]);
  }
  if (!(await isCompletedRetry(deps, { actorAccountId: staff.accountId, operation: 'staff.intake', subjectKey: membership.shelterId!, key }))) {
    await enforce(deps, `staff-intake:${staff.accountId}`, deps.config.limits.staffIntakePerHour, HOUR);
  }

  const result = await idempotent<{ assistanceSecret?: string; contactCode?: string }>(
    deps,
    { actorAccountId: staff.accountId, operation: 'staff.intake', subjectKey: membership.shelterId!, key, payload: input },
    async (tx) => {
      const now = deps.clock.now();
      const personId = randomUUID();
      await tx.person.create({
        data: {
          id: personId,
          incidentId: membership.incidentId,
          alias: input.alias,
          requestMode,
          restrictedReferral: restricted,
          encryptedMatchingClue: input.matchingClue ? deps.crypto.encrypt(input.matchingClue, 'person.matchingClue', personId) : null,
          createdAt: now,
        },
      });
      const kase = await tx.assistanceCase.create({
        data: {
          personId,
          incidentId: membership.incidentId,
          shelterId: membership.shelterId!,
          reference: generateCaseReference(),
          createdAt: now,
          lastActivityAt: now,
        },
      });
      await tx.caseAssignment.create({
        data: {
          caseId: kase.id,
          incidentId: membership.incidentId,
          membershipId: membership.id,
          staffAccountId: staff.accountId,
          purposes: ['INTAKE', 'ASSIST'],
          startsAt: now,
          assignedByAccountId: staff.accountId,
        },
      });
      // Intake is witnessed in person; it counts as this worker's first verification.
      const session = await tx.assistanceSession.create({
        data: { caseId: kase.id, staffAccountId: staff.accountId, method: 'INTAKE_WITNESS', verifiedAt: now, expiresAt: new Date(now.getTime() + ASSISTANCE_SESSION_MS) },
      });
      await tx.consentRecord.create({
        data: {
          personId,
          actorAccountId: staff.accountId,
          caseId: kase.id,
          assistanceSessionId: session.id,
          action: 'INTAKE_PARTICIPATION',
          detail: restricted ? 'RESTRICTED_REFERRAL' : requestMode,
          statedAt: now,
          recordedAt: now,
          policyVersion: POLICY_VERSION,
        },
      });
      let assistanceSecret: string | undefined;
      let contactCode: string | undefined;
      if (!restricted) {
        assistanceSecret = generateSecret();
        await tx.assistanceCredential.create({
          data: { personId, digest: deps.crypto.digest('assistance', normalizeSecret(assistanceSecret)), issuedAt: now },
        });
        const auth: SubjectAuthority = { personId, actorAccountId: staff.accountId, authorityType: 'ASSISTED_CASE', caseId: kase.id, assistanceSessionId: session.id };
        if (input.checkIn) {
          await createCheckIn(deps, tx, auth, { ...input.checkIn, shelterId: membership.shelterId! });
        }
        if (input.issueContactCode) {
          contactCode = generateSecret();
          await tx.contactCode.create({ data: { personId, digest: deps.crypto.digest('contact-code', normalizeSecret(contactCode)), createdAt: now } });
        }
      }
      await audit(tx, {
        actorAccountId: staff.accountId,
        action: 'case.intake',
        objectType: 'AssistanceCase',
        objectId: kase.id,
        authorityType: 'MEMBERSHIP',
        authorityId: membership.id,
        result: 'SUCCEEDED',
        at: now,
      });
      return { outcomeType: 'AssistanceCase', outcomeId: kase.id, extra: { assistanceSecret, contactCode } };
    },
  );
  const kase = await deps.prisma.assistanceCase.findUniqueOrThrow({ where: { id: result.outcomeId } });
  return {
    replayed: result.replayed,
    body: {
      caseId: kase.id,
      reference: kase.reference,
      ...(result.extra?.assistanceSecret ? { assistanceSecret: result.extra.assistanceSecret } : {}),
      ...(result.extra?.contactCode ? { contactCode: result.extra.contactCode } : {}),
    },
  };
}

/** Assignment-filtered case view. Sensitive sections require this worker's current verification. */
export async function caseView(deps: Deps, scope: CaseScope, extra?: (scope: CaseScope) => Promise<Record<string, unknown>>) {
  const person = await deps.prisma.person.findUniqueOrThrow({
    where: { id: scope.kase.personId },
    include: { contactCodes: { where: { revokedAt: null }, select: { createdAt: true } } },
  });
  const shelter = await deps.prisma.shelter.findUniqueOrThrow({ where: { id: scope.kase.shelterId } });
  const base = {
    caseId: scope.kase.id,
    reference: scope.kase.reference,
    alias: person.deletedAt ? '(deleted)' : person.alias,
    state: scope.kase.state,
    shelter: { name: shelter.name },
    restrictedReferral: person.restrictedReferral,
    ...(person.restrictedReferral ? { referralGuidance: REFERRAL_GUIDANCE } : {}),
    requestMode: person.requestMode,
    version: person.version,
    escalationOpenedAt: scope.kase.escalationOpenedAt?.toISOString() ?? null,
    assistance: { verified: !!scope.session, verifiedUntil: scope.session?.expiresAt.toISOString() ?? null },
  };
  if (!scope.session || person.deletedAt) return base;
  const [checkIns, maps] = await Promise.all([
    deps.prisma.checkIn.findMany({ where: { personId: person.id }, orderBy: { observedAt: 'desc' }, take: 50 }),
    placeMaps(deps),
  ]);
  return {
    ...base,
    matchingClue: person.encryptedMatchingClue ? deps.crypto.decrypt(person.encryptedMatchingClue, 'person.matchingClue', person.id) : null,
    contactCode: person.contactCodes[0] ? { active: true, createdAt: person.contactCodes[0].createdAt.toISOString() } : { active: false, createdAt: null },
    checkIns: checkIns.map((c) => toOwnCheckInDto(c, maps)),
    ...(extra ? await extra(scope) : {}),
  };
}

export async function verifyAssistance(deps: Deps, staff: StaffContext, caseId: string, secret: string) {
  const scope = await loadAssignedCase(deps, staff, caseId);
  const failScope = `assist-fail:${staff.accountId}:${caseId}`;
  const failures = await peek(deps, failScope, 15 * MINUTE);
  if (failures.count >= deps.config.limits.assistVerify) throw rateLimited(failures.retryAfterSeconds);
  const now = deps.clock.now();
  const credential = isWellFormedSecret(secret)
    ? await deps.prisma.assistanceCredential.findFirst({
        where: { personId: scope.kase.personId, revokedAt: null, digest: deps.crypto.digest('assistance', normalizeSecret(secret)) },
      })
    : null;
  if (!credential) {
    await consume(deps, failScope, 15 * MINUTE);
    await audit(deps.prisma, { actorAccountId: staff.accountId, action: 'case.verify', objectType: 'AssistanceCase', objectId: caseId, authorityType: 'ASSIGNMENT', authorityId: scope.assignment.id, result: 'FAILED', at: now });
    throw new AppError(403, 'FORBIDDEN', 'The assistance secret was not accepted. A case reference card cannot be used instead.');
  }
  const session = await deps.prisma.$transaction(async (tx) => {
    await tx.assistanceSession.updateMany({ where: { caseId, staffAccountId: staff.accountId, revokedAt: null }, data: { revokedAt: now } });
    const s = await tx.assistanceSession.create({
      data: { caseId, staffAccountId: staff.accountId, method: 'SECRET', verifiedAt: now, expiresAt: new Date(now.getTime() + ASSISTANCE_SESSION_MS) },
    });
    await tx.assistanceCase.update({ where: { id: caseId }, data: { lastActivityAt: now } });
    await audit(tx, { actorAccountId: staff.accountId, action: 'case.verify', objectType: 'AssistanceCase', objectId: caseId, authorityType: 'ASSIGNMENT', authorityId: scope.assignment.id, result: 'SUCCEEDED', at: now });
    return s;
  });
  return { verifiedUntil: session.expiresAt.toISOString() };
}

export async function endAssistance(deps: Deps, staff: StaffContext, caseId: string) {
  await loadAssignedCase(deps, staff, caseId);
  await deps.prisma.assistanceSession.updateMany({ where: { caseId, staffAccountId: staff.accountId, revokedAt: null }, data: { revokedAt: deps.clock.now() } });
}

/** Missing secret: record a manual escalation. No disclosure and no account linking follow from it. */
export async function escalate(deps: Deps, staff: StaffContext, caseId: string) {
  const scope = await loadAssignedCase(deps, staff, caseId);
  const now = deps.clock.now();
  const kase = await deps.prisma.assistanceCase.update({
    where: { id: caseId },
    data: { escalationOpenedAt: scope.kase.escalationOpenedAt ?? now },
  });
  await audit(deps.prisma, { actorAccountId: staff.accountId, action: 'case.escalate', objectType: 'AssistanceCase', objectId: caseId, authorityType: 'ASSIGNMENT', authorityId: scope.assignment.id, result: 'SUCCEEDED', at: now });
  return { escalationOpenedAt: kase.escalationOpenedAt!.toISOString() };
}

export async function rotateAssistanceSecret(deps: Deps, auth: SubjectAuthority) {
  const now = deps.clock.now();
  const secret = generateSecret();
  await deps.prisma.$transaction(async (tx) => {
    await tx.assistanceCredential.updateMany({ where: { personId: auth.personId, revokedAt: null }, data: { revokedAt: now } });
    await tx.assistanceCredential.create({ data: { personId: auth.personId, digest: deps.crypto.digest('assistance', normalizeSecret(secret)), issuedAt: now } });
    await audit(tx, { actorAccountId: auth.actorAccountId, action: 'case.assistanceSecret.rotate', objectType: 'Person', objectId: auth.personId, authorityType: auth.authorityType, authorityId: auth.caseId ?? null, result: 'SUCCEEDED', at: now });
  });
  return secret;
}

/** Coordinator assigns an eligible local staff member. No self-assignment; no data access for the coordinator. */
export async function assignStaff(deps: Deps, staff: StaffContext, caseId: string, input: { membershipId: string; purposes: ('INTAKE' | 'ASSIST')[] }) {
  const kase = await deps.prisma.assistanceCase.findUnique({ where: { id: caseId } });
  if (!kase || kase.state !== 'ACTIVE') throw notFound();
  const coordinator = coordinatorMembership(staff, kase.shelterId, kase.incidentId);
  if (!coordinator) throw notFound();
  const target = await deps.prisma.staffMembership.findUnique({ where: { id: input.membershipId } });
  if (!target || target.state !== 'ACTIVE' || target.shelterId !== kase.shelterId || target.incidentId !== kase.incidentId || target.role === 'OPERATOR') {
    throw validation([{ path: 'membershipId', message: 'Choose an active staff member at this shelter.' }]);
  }
  if (target.accountId === staff.accountId) throw forbidden('Coordinators cannot assign cases to themselves. Ask another coordinator.');
  const now = deps.clock.now();
  const existing = await deps.prisma.caseAssignment.findFirst({ where: { caseId, staffAccountId: target.accountId, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } });
  if (existing) throw conflict('That staff member is already assigned to this case.');
  const assignment = await deps.prisma.$transaction(async (tx) => {
    const a = await tx.caseAssignment.create({
      data: { caseId, incidentId: kase.incidentId, membershipId: target.id, staffAccountId: target.accountId, purposes: input.purposes, startsAt: now, assignedByAccountId: staff.accountId },
    });
    await audit(tx, { actorAccountId: staff.accountId, action: 'case.assign', objectType: 'CaseAssignment', objectId: a.id, authorityType: 'COORDINATOR', authorityId: coordinator.id, result: 'SUCCEEDED', at: now });
    return a;
  }).catch((e: unknown) => {
    // A concurrent identical assignment hit the one-active-assignment unique index.
    if ((e as { code?: string }).code === 'P2002') throw conflict('That staff member is already assigned to this case.');
    throw e;
  });
  return { assignmentId: assignment.id };
}

export async function endAssignment(deps: Deps, staff: StaffContext, caseId: string, assignmentId: string) {
  const kase = await deps.prisma.assistanceCase.findUnique({ where: { id: caseId } });
  if (!kase) throw notFound();
  const coordinator = coordinatorMembership(staff, kase.shelterId, kase.incidentId);
  if (!coordinator) throw notFound();
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const a = await tx.caseAssignment.findFirst({ where: { id: assignmentId, caseId, endsAt: null } });
    if (!a) throw notFound();
    await tx.caseAssignment.update({ where: { id: a.id }, data: { endsAt: now, endedReason: 'COORDINATOR_ENDED' } });
    await tx.assistanceSession.updateMany({ where: { caseId, staffAccountId: a.staffAccountId, revokedAt: null }, data: { revokedAt: now } });
    await audit(tx, { actorAccountId: staff.accountId, action: 'case.assignment.end', objectType: 'CaseAssignment', objectId: a.id, authorityType: 'COORDINATOR', authorityId: coordinator.id, result: 'SUCCEEDED', at: now });
  });
}

export async function eligibleStaff(deps: Deps, staff: StaffContext, shelterId: string) {
  if (!coordinatorMembership(staff, shelterId)) throw notFound();
  const members = await deps.prisma.staffMembership.findMany({
    where: { shelterId, state: 'ACTIVE', role: { in: ['WORKER', 'COORDINATOR'] } },
    include: { account: { select: { normalizedUsername: true } } },
  });
  return members.map((m) => ({ membershipId: m.id, username: m.account.normalizedUsername, role: m.role, isYou: m.accountId === staff.accountId }));
}

export const REVIEW_AFTER_MS = 30 * 24 * HOUR;

/** Own assignments (with alias) plus, for coordinators, a minimal case index without person content. */
export async function staffTasks(deps: Deps, staff: StaffContext, extra?: () => Promise<Record<string, unknown>>) {
  const now = deps.clock.now();
  const activeMemberships = staff.memberships.filter((m) => m.role !== 'OPERATOR');
  const assignments = await deps.prisma.caseAssignment.findMany({
    where: {
      staffAccountId: staff.accountId,
      membershipId: { in: activeMemberships.map((m) => m.id) },
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      case: { state: 'ACTIVE' },
    },
    include: { case: { include: { person: { select: { alias: true, restrictedReferral: true, deletedAt: true } } } } },
    orderBy: { startsAt: 'desc' },
  });
  const sessions = await deps.prisma.assistanceSession.findMany({
    where: { staffAccountId: staff.accountId, revokedAt: null, expiresAt: { gt: now }, caseId: { in: assignments.map((a) => a.caseId) } },
  });
  const maps = await placeMaps(deps);
  const cases = assignments
    .filter((a) => {
      const m = activeMemberships.find((x) => x.id === a.membershipId);
      return m && m.shelterId === a.case.shelterId;
    })
    .map((a) => ({
      caseId: a.caseId,
      reference: a.case.reference,
      alias: a.case.person.deletedAt ? '(deleted)' : a.case.person.alias,
      shelterName: maps.shelters.get(a.case.shelterId)?.name ?? '',
      restrictedReferral: a.case.person.restrictedReferral,
      purposes: a.purposes,
      verifiedUntil: sessions.find((s) => s.caseId === a.caseId)?.expiresAt.toISOString() ?? null,
      escalationOpen: !!a.case.escalationOpenedAt,
    }));
  const coordinatorShelters = staff.memberships.filter((m) => m.role === 'COORDINATOR' && m.shelterId).map((m) => m.shelterId!);
  const indexRows = coordinatorShelters.length
    ? await deps.prisma.assistanceCase.findMany({
        where: { shelterId: { in: coordinatorShelters }, state: 'ACTIVE' },
        include: { assignments: { where: { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { id: true } } },
        orderBy: { lastActivityAt: 'asc' },
        take: 200,
      })
    : [];
  const caseIndex = indexRows.map((c) => ({
    caseId: c.id,
    reference: c.reference,
    shelterName: maps.shelters.get(c.shelterId)?.name ?? '',
    createdAt: c.createdAt.toISOString(),
    lastActivityAt: c.lastActivityAt.toISOString(),
    activeAssignments: c.assignments.length,
    reviewDue: reviewDue(c, now),
  }));
  return { cases, caseIndex, ...(extra ? await extra() : {}) };
}

export function reviewDue(c: { lastActivityAt: Date; lastReviewedAt: Date | null; reviewExtendedUntil: Date | null }, now: Date): boolean {
  if (c.reviewExtendedUntil && c.reviewExtendedUntil > now) return false;
  const anchor = Math.max(c.lastActivityAt.getTime(), c.lastReviewedAt?.getTime() ?? 0);
  return now.getTime() - anchor > REVIEW_AFTER_MS;
}

/** Coordinator closes a local case: assignments end, no disclosure happens, content follows retention. */
export async function closeCase(deps: Deps, staff: StaffContext, caseId: string) {
  const kase = await deps.prisma.assistanceCase.findUnique({ where: { id: caseId } });
  if (!kase || kase.state !== 'ACTIVE') throw notFound();
  const coordinator = coordinatorMembership(staff, kase.shelterId, kase.incidentId);
  if (!coordinator) throw notFound();
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    await tx.assistanceCase.update({ where: { id: caseId }, data: { state: 'CLOSED', closedAt: now, version: { increment: 1 } } });
    await tx.caseAssignment.updateMany({ where: { caseId, endsAt: null }, data: { endsAt: now, endedReason: 'CASE_CLOSED' } });
    await tx.assistanceSession.updateMany({ where: { caseId, revokedAt: null }, data: { revokedAt: now } });
    await tx.caseTransfer.updateMany({ where: { caseId, state: 'PROPOSED' }, data: { state: 'CANCELLED', decidedAt: now } });
    await audit(tx, { actorAccountId: staff.accountId, action: 'case.close', objectType: 'AssistanceCase', objectId: caseId, authorityType: 'COORDINATOR', authorityId: coordinator.id, result: 'SUCCEEDED', at: now });
  });
}

/** Explicitly keeps an inactive case open for another 30 days (recorded review). */
export async function extendCaseReview(deps: Deps, staff: StaffContext, caseId: string) {
  const kase = await deps.prisma.assistanceCase.findUnique({ where: { id: caseId } });
  if (!kase || kase.state !== 'ACTIVE') throw notFound();
  const coordinator = coordinatorMembership(staff, kase.shelterId, kase.incidentId);
  if (!coordinator) throw notFound();
  const now = deps.clock.now();
  await deps.prisma.assistanceCase.update({ where: { id: caseId }, data: { lastReviewedAt: now, reviewExtendedUntil: new Date(now.getTime() + REVIEW_AFTER_MS) } });
  await audit(deps.prisma, { actorAccountId: staff.accountId, action: 'case.review.extend', objectType: 'AssistanceCase', objectId: caseId, authorityType: 'COORDINATOR', authorityId: coordinator.id, result: 'SUCCEEDED', at: now });
}
