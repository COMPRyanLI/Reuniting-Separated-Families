import type { AssistanceCase, AssistanceSession, CaseAssignment, StaffMembership } from '@prisma/client';
import type { Deps } from '../deps.js';
import { AppError, notFound } from '../lib/errors.js';
import type { SubjectAuthority } from '../services/people.js';
import type { StaffContext } from './staff.js';

export interface CaseScope {
  kase: AssistanceCase;
  assignment: CaseAssignment;
  membership: StaffMembership;
  session: AssistanceSession | null;
}

/**
 * case.readAssigned: the staff member must hold an active, unexpired assignment on an
 * active case, through an ACTIVE membership at the case's current shelter. Anything else
 * is the neutral 404, identical to a nonexistent case.
 */
export async function loadAssignedCase(deps: Deps, staff: StaffContext, caseId: string): Promise<CaseScope> {
  const now = deps.clock.now();
  const kase = await deps.prisma.assistanceCase.findUnique({ where: { id: caseId } });
  if (!kase || kase.state !== 'ACTIVE') throw notFound();
  const memberships = staff.memberships.filter((m) => m.shelterId === kase.shelterId && m.incidentId === kase.incidentId && m.role !== 'OPERATOR');
  if (memberships.length === 0) throw notFound();
  const assignment = await deps.prisma.caseAssignment.findFirst({
    where: {
      caseId,
      staffAccountId: staff.accountId,
      membershipId: { in: memberships.map((m) => m.id) },
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
  });
  if (!assignment) throw notFound();
  const session = await deps.prisma.assistanceSession.findFirst({
    where: { caseId, staffAccountId: staff.accountId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { verifiedAt: 'desc' },
  });
  return { kase, assignment, membership: memberships.find((m) => m.id === assignment.membershipId)!, session };
}

/** Sensitive assisted actions additionally need this staff member's own current verification. */
export function requireVerified(scope: CaseScope): AssistanceSession {
  if (!scope.session) throw verificationRequiredError();
  return scope.session;
}

export function verificationRequiredError() {
  return new AppError(403, 'VERIFICATION_REQUIRED', "Verify the person's private assistance secret before this action.");
}

export function assistedAuthority(scope: CaseScope, staff: StaffContext): SubjectAuthority {
  const session = requireVerified(scope);
  return {
    personId: scope.kase.personId,
    actorAccountId: staff.accountId,
    authorityType: 'ASSISTED_CASE',
    caseId: scope.kase.id,
    assistanceSessionId: session.id,
  };
}

/** Coordinator authority over a shelter: allocation metadata only, never person content. */
export function coordinatorMembership(staff: StaffContext, shelterId: string, incidentId?: string): StaffMembership | undefined {
  return staff.memberships.find(
    (m) => m.role === 'COORDINATOR' && m.shelterId === shelterId && (!incidentId || m.incidentId === incidentId),
  );
}
