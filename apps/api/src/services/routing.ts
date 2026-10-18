import type { Prisma } from '@prisma/client';
import type { RequestCreateInput } from '@rf/contracts';
import type { Deps } from '../deps.js';
import { conflict, forbidden, notFound, validation } from '../lib/errors.js';
import { enqueue } from '../jobs/outbox.js';
import { coordinatorMembership } from '../policy/case.js';
import type { StaffContext } from '../policy/staff.js';
import { audit } from './audit.js';
import { POLICY_VERSION, type SubjectAuthority } from './people.js';
import { createRequest, lockRequest } from './requests.js';

/** Creates a code or no-code request; a no-code request with a consented lead opens one route. */
export async function createRoutedRequest(deps: Deps, auth: SubjectAuthority, input: RequestCreateInput, key: string) {
  if (input.routeType === 'CODE') return createRequest(deps, auth, input, key);
  return createRequest(deps, auth, input, key, async (tx, request) => {
    if (input.destinationShelterId) await openRoute(deps, tx, auth, request.id, request.incidentId, input.destinationShelterId);
  });
}

/**
 * Records the requester's explicit relay choice and routes to exactly one shelter.
 * Any previous route ends, so the previous destination loses task access.
 */
async function openRoute(deps: Deps, tx: Prisma.TransactionClient, auth: SubjectAuthority, requestId: string, incidentId: string, shelterId: string) {
  const now = deps.clock.now();
  const consent = await tx.consentRecord.create({
    data: {
      personId: auth.personId,
      actorAccountId: auth.actorAccountId,
      caseId: auth.caseId ?? null,
      assistanceSessionId: auth.assistanceSessionId ?? null,
      action: 'RELAY_CLUES',
      resourceId: shelterId,
      statedAt: now,
      recordedAt: now,
      policyVersion: POLICY_VERSION,
    },
  });
  await tx.requestRoute.updateMany({ where: { requestId, endedAt: null }, data: { state: 'ENDED', endedAt: now } });
  const route = await tx.requestRoute.create({
    data: { requestId, incidentId, destinationShelterId: shelterId, relayConsentId: consent.id, createdAt: now },
  });
  await tx.reunionRequest.update({ where: { id: requestId }, data: { internalState: 'ROUTING' } });
  await audit(tx, { actorAccountId: auth.actorAccountId, action: 'route.open', objectType: 'RequestRoute', objectId: route.id, authorityType: auth.authorityType, authorityId: auth.caseId ?? null, result: 'SUCCEEDED', at: now });
}

/**
 * New lead from the requester. While the request is still being routed this opens a new
 * route; once a hidden decision exists it only records the choice, so the requester's
 * experience is identical either way.
 */
export async function updateLead(
  deps: Deps,
  auth: SubjectAuthority,
  requestId: string,
  input: { destinationShelterId: string; clues?: string; relayConsent: true; expectedVersion: number },
) {
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (!r || r.requesterPersonId !== auth.personId) throw notFound();
    if (r.routeType !== 'ROUTED') throw validation([{ path: 'destinationShelterId', message: 'Requests sent with a contact code do not use shelter leads.' }]);
    if (r.withdrawnAt || now >= r.expiresAt) throw conflict('This request is closed.');
    if (r.internalState === 'RESPONDED') throw conflict('This request already has a response.');
    if (r.version !== input.expectedVersion) throw conflict('This request changed. Refresh and try again.');
    const shelter = await tx.shelter.findFirst({ where: { id: input.destinationShelterId, incidentId: r.incidentId, state: 'OPEN', isPublic: true } });
    if (!shelter) throw validation([{ path: 'destinationShelterId', message: 'Choose a shelter from the list.' }]);
    await tx.reunionRequest.update({
      where: { id: requestId },
      data: {
        version: { increment: 1 },
        ...(input.clues !== undefined ? { encryptedClues: input.clues ? deps.crypto.encrypt(input.clues, 'request.clues', requestId) : null } : {}),
      },
    });
    if (r.internalState === 'UNRESOLVED' || r.internalState === 'ROUTING') {
      await openRoute(deps, tx, auth, requestId, r.incidentId, shelter.id);
    } else {
      // A decision is already pending or made privately: record the choice only.
      await tx.consentRecord.create({
        data: {
          personId: auth.personId,
          actorAccountId: auth.actorAccountId,
          caseId: auth.caseId ?? null,
          assistanceSessionId: auth.assistanceSessionId ?? null,
          action: 'RELAY_CLUES',
          resourceId: shelter.id,
          detail: 'NOT_ROUTED',
          statedAt: now,
          recordedAt: now,
          policyVersion: POLICY_VERSION,
        },
      });
    }
    await audit(tx, { actorAccountId: auth.actorAccountId, action: 'request.lead', objectType: 'ReunionRequest', objectId: requestId, authorityType: auth.authorityType, authorityId: auth.caseId ?? null, result: 'SUCCEEDED', at: now });
  });
}

async function activeRoute(deps: Deps, routeId: string) {
  const route = await deps.prisma.requestRoute.findUnique({ where: { id: routeId } });
  if (!route || route.endedAt) throw notFound();
  return route;
}

/** route.assign: the destination shelter's coordinator assigns an eligible local worker. */
export async function assignRoute(deps: Deps, staff: StaffContext, routeId: string, membershipId: string) {
  const route = await activeRoute(deps, routeId);
  const coordinator = coordinatorMembership(staff, route.destinationShelterId, route.incidentId);
  if (!coordinator) throw notFound();
  const target = await deps.prisma.staffMembership.findUnique({ where: { id: membershipId } });
  if (!target || target.state !== 'ACTIVE' || target.shelterId !== route.destinationShelterId || target.role === 'OPERATOR') {
    throw validation([{ path: 'membershipId', message: 'Choose an active staff member at this shelter.' }]);
  }
  if (target.accountId === staff.accountId) throw forbidden('Coordinators cannot assign matching tasks to themselves.');
  const now = deps.clock.now();
  const updated = await deps.prisma.requestRoute.updateMany({
    where: { id: routeId, endedAt: null, state: { in: ['PENDING_ASSIGNMENT', 'ASSIGNED', 'NO_MATCH'] } },
    data: { state: 'ASSIGNED', assignedWorkerAccountId: target.accountId, assignedWorkerMembershipId: target.id, assignedByAccountId: staff.accountId, assignedAt: now, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw conflict('This task changed. Refresh and try again.');
  await deps.prisma.reunionRequest.updateMany({ where: { id: route.requestId, internalState: 'UNRESOLVED' }, data: { internalState: 'ROUTING' } });
  await audit(deps.prisma, { actorAccountId: staff.accountId, action: 'route.assign', objectType: 'RequestRoute', objectId: routeId, authorityType: 'COORDINATOR', authorityId: coordinator.id, result: 'SUCCEEDED', at: now });
}

/**
 * matching.readMinimal authority: the route is active and ASSIGNED to this worker through an
 * active membership at the destination shelter, and the request is still being routed.
 */
async function requireMatchingTask(deps: Deps, staff: StaffContext, routeId: string) {
  const route = await activeRoute(deps, routeId);
  if (route.state !== 'ASSIGNED' || route.assignedWorkerAccountId !== staff.accountId) throw notFound();
  const membership = staff.memberships.find((m) => m.id === route.assignedWorkerMembershipId && m.shelterId === route.destinationShelterId);
  if (!membership) throw notFound();
  const request = await deps.prisma.reunionRequest.findUnique({ where: { id: route.requestId } });
  if (!request || request.internalState !== 'ROUTING' || request.withdrawnAt || request.expiresAt <= deps.clock.now()) throw notFound();
  return { route, request };
}

export async function routeTaskView(deps: Deps, staff: StaffContext, routeId: string) {
  const { route, request } = await requireMatchingTask(deps, staff, routeId);
  return {
    routeId: route.id,
    requesterAlias: request.requesterAliasSnapshot,
    clues: request.encryptedClues ? deps.crypto.decrypt(request.encryptedClues, 'request.clues', request.id) : null,
    requestExpiresAt: request.expiresAt.toISOString(),
  };
}

function candidateToken(deps: Deps, routeId: string, personId: string) {
  return deps.crypto.digest('candidate', `${routeId}:${personId}`);
}

/**
 * Minimal local candidates: active cases at the destination shelter whose people opted
 * into ASSISTED matching. Alias and volunteered clue only; no IDs, locations or history.
 */
export async function listCandidates(deps: Deps, staff: StaffContext, routeId: string) {
  const { route, request } = await requireMatchingTask(deps, staff, routeId);
  const cases = await deps.prisma.assistanceCase.findMany({
    where: {
      shelterId: route.destinationShelterId,
      incidentId: route.incidentId,
      state: 'ACTIVE',
      person: { requestMode: 'ASSISTED', restrictedReferral: false, deletedAt: null, id: { not: request.requesterPersonId } },
    },
    include: { person: true },
    take: 200,
  });
  const blocks = await deps.prisma.block.findMany({ where: { blockedPersonId: request.requesterPersonId, subjectPersonId: { in: cases.map((c) => c.personId) } } });
  await audit(deps.prisma, { actorAccountId: staff.accountId, action: 'route.candidates', objectType: 'RequestRoute', objectId: routeId, authorityType: 'ROUTE_TASK', authorityId: routeId, result: 'ALLOWED', at: deps.clock.now() });
  return cases
    .filter((c) => !blocks.some((b) => b.subjectPersonId === c.personId))
    .map((c) => ({
      candidateToken: candidateToken(deps, routeId, c.personId),
      alias: c.person.alias,
      clue: c.person.encryptedMatchingClue ? deps.crypto.decrypt(c.person.encryptedMatchingClue, 'person.matchingClue', c.person.id) : null,
    }));
}

/** Proposal, not a match: delivers the request for the candidate's own decision. Never a grant. */
export async function proposeRecipient(deps: Deps, staff: StaffContext, routeId: string, token: string) {
  const { route } = await requireMatchingTask(deps, staff, routeId);
  const cases = await deps.prisma.assistanceCase.findMany({
    where: { shelterId: route.destinationShelterId, state: 'ACTIVE', person: { requestMode: 'ASSISTED', restrictedReferral: false, deletedAt: null } },
    select: { personId: true },
  });
  const chosen = cases.find((c) => deps.crypto.digestEquals(candidateToken(deps, routeId, c.personId), token));
  if (!chosen) throw validation([{ path: 'candidateToken', message: 'That person is no longer a current candidate. Refresh the list.' }]);
  await deps.hooks?.afterMatchingTaskCheck?.();
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const r = await lockRequest(tx, route.requestId);
    // Re-check consent and eligibility under a row lock: a privacy change racing this proposal wins.
    const candidate = await tx.$queryRaw<{ requestMode: string; restrictedReferral: boolean; deletedAt: Date | null }[]>`
      SELECT "requestMode"::text AS "requestMode", "restrictedReferral", "deletedAt" FROM "Person" WHERE "id" = ${chosen.personId}::uuid FOR SHARE`;
    const stillLocal = await tx.assistanceCase.count({ where: { personId: chosen.personId, shelterId: route.destinationShelterId, state: 'ACTIVE' } });
    const c = candidate[0];
    if (!c || c.requestMode !== 'ASSISTED' || c.restrictedReferral || c.deletedAt || stillLocal === 0) {
      throw validation([{ path: 'candidateToken', message: 'That person is no longer a current candidate. Refresh the list.' }]);
    }
    if (!r || r.internalState !== 'ROUTING' || r.withdrawnAt || now >= r.expiresAt) throw conflict('This request is no longer being routed.');
    if (chosen.personId === r.requesterPersonId) throw validation([{ path: 'candidateToken', message: 'Not a valid candidate.' }]);
    const blocked = await tx.block.findUnique({ where: { subjectPersonId_blockedPersonId: { subjectPersonId: chosen.personId, blockedPersonId: r.requesterPersonId } } });
    if (blocked) throw validation([{ path: 'candidateToken', message: 'That person is no longer a current candidate. Refresh the list.' }]);
    // Only the worker who currently holds the task can complete it (a reassignment wins).
    const moved = await tx.requestRoute.updateMany({
      where: { id: routeId, state: 'ASSIGNED', endedAt: null, assignedWorkerAccountId: staff.accountId, assignedWorkerMembershipId: route.assignedWorkerMembershipId },
      data: { state: 'PROPOSED', version: { increment: 1 } },
    });
    if (moved.count !== 1) throw conflict('This task changed. Refresh and try again.');
    await tx.reunionRequest.update({
      where: { id: r.id },
      data: { recipientPersonId: chosen.personId, internalState: 'AWAITING_DECISION', deliveredAt: now, version: { increment: 1 } },
    });
    await enqueue(deps, tx, { kind: 'request.notifyRecipient', requestId: r.id }, `request.notifyRecipient:${r.id}:${routeId}`);
    await audit(tx, { actorAccountId: staff.accountId, action: 'route.propose', objectType: 'RequestRoute', objectId: routeId, authorityType: 'ROUTE_TASK', authorityId: routeId, result: 'SUCCEEDED', at: now });
  });
}

/** No match at this shelter: internally unresolved; the requester's view does not change. */
export async function markNoMatch(deps: Deps, staff: StaffContext, routeId: string) {
  const route = await activeRoute(deps, routeId);
  const isWorker = route.assignedWorkerAccountId === staff.accountId && staff.memberships.some((m) => m.id === route.assignedWorkerMembershipId);
  const coordinator = coordinatorMembership(staff, route.destinationShelterId, route.incidentId);
  if (!isWorker && !coordinator) throw notFound();
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const r = await lockRequest(tx, route.requestId);
    const moved = await tx.requestRoute.updateMany({ where: { id: routeId, endedAt: null, state: { in: ['PENDING_ASSIGNMENT', 'ASSIGNED'] } }, data: { state: 'NO_MATCH', version: { increment: 1 } } });
    if (moved.count !== 1) throw conflict('This task changed. Refresh and try again.');
    if (r && r.internalState === 'ROUTING') await tx.reunionRequest.update({ where: { id: r.id }, data: { internalState: 'UNRESOLVED' } });
    await audit(tx, { actorAccountId: staff.accountId, action: 'route.noMatch', objectType: 'RequestRoute', objectId: routeId, authorityType: isWorker ? 'ROUTE_TASK' : 'COORDINATOR', result: 'SUCCEEDED', at: now });
  });
}

/**
 * Generic prompt to the requester for another lead. Allowed for the coordinator of the
 * latest destination, or of the shelter where the requester has an active case.
 */
export async function askForLead(deps: Deps, staff: StaffContext, requestId: string) {
  const request = await deps.prisma.reunionRequest.findUnique({ where: { id: requestId } });
  if (!request || request.routeType !== 'ROUTED') throw notFound();
  const route = await deps.prisma.requestRoute.findFirst({ where: { requestId, endedAt: null } });
  const requesterCase = await deps.prisma.assistanceCase.findFirst({ where: { personId: request.requesterPersonId, state: 'ACTIVE' } });
  const authority =
    (route && coordinatorMembership(staff, route.destinationShelterId, route.incidentId)) ||
    (requesterCase && coordinatorMembership(staff, requesterCase.shelterId, requesterCase.incidentId));
  if (!authority) throw notFound();
  // Same answer for every request state (open, answered, declined, withdrawn, expired), so a
  // coordinator cannot use this endpoint to learn hidden outcomes. Delivery rechecks the state.
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const ask = await tx.leadAsk.create({ data: { requestId, askedByAccountId: staff.accountId, createdAt: now } });
    await enqueue(deps, tx, { kind: 'lead.requested', requestId, askId: ask.id }, `lead.requested:${ask.id}`);
    await audit(tx, { actorAccountId: staff.accountId, action: 'route.askForLead', objectType: 'ReunionRequest', objectId: requestId, authorityType: 'COORDINATOR', authorityId: authority.id, result: 'SUCCEEDED', at: now });
  });
}

/** Coordinator queues: incoming routes at their shelters and no-lead requests from their local cases. */
export async function routingQueues(deps: Deps, staff: StaffContext) {
  const coordinatorShelters = staff.memberships.filter((m) => m.role === 'COORDINATOR' && m.shelterId).map((m) => m.shelterId!);
  const now = deps.clock.now();
  const routes = coordinatorShelters.length
    ? await deps.prisma.requestRoute.findMany({
        where: { destinationShelterId: { in: coordinatorShelters }, endedAt: null, state: { in: ['PENDING_ASSIGNMENT', 'ASSIGNED', 'NO_MATCH'] } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      })
    : [];
  const routeRequests = await deps.prisma.reunionRequest.findMany({ where: { id: { in: routes.map((r) => r.requestId) } } });
  const workers = await deps.prisma.account.findMany({ where: { id: { in: routes.map((r) => r.assignedWorkerAccountId).filter((x): x is string => !!x) } }, select: { id: true, normalizedUsername: true } });
  const routeQueue = routes
    .map((route) => ({ route, req: routeRequests.find((x) => x.id === route.requestId) }))
    .filter(({ req }) => req && !req.withdrawnAt && req.expiresAt > now)
    .map(({ route, req }) => ({
      routeId: route.id,
      requestId: route.requestId,
      state: route.state,
      createdAt: route.createdAt.toISOString(),
      assignedWorker: workers.find((w) => w.id === route.assignedWorkerAccountId)?.normalizedUsername ?? null,
      clues: req!.encryptedClues ? deps.crypto.decrypt(req!.encryptedClues, 'request.clues', req!.id) : null,
      shelterId: route.destinationShelterId,
    }));
  const localCases = coordinatorShelters.length
    ? await deps.prisma.assistanceCase.findMany({ where: { shelterId: { in: coordinatorShelters }, state: 'ACTIVE' }, select: { personId: true, reference: true } })
    : [];
  const unresolved = localCases.length
    ? await deps.prisma.reunionRequest.findMany({
        where: { routeType: 'ROUTED', internalState: 'UNRESOLVED', withdrawnAt: null, expiresAt: { gt: now }, requesterPersonId: { in: localCases.map((c) => c.personId) } },
        take: 100,
      })
    : [];
  // Only requests that never reached a shelter route. A route that ended in "no match" stays active
  // until a new lead, so the origin coordinator cannot tell a hidden outcome from a pending one.
  // Clues are not shown: the requester consented to share them only with a chosen destination.
  const activeRoutes = await deps.prisma.requestRoute.findMany({ where: { requestId: { in: unresolved.map((u) => u.id) }, endedAt: null } });
  const leadReview = unresolved
    .filter((u) => !activeRoutes.some((r) => r.requestId === u.id))
    .map((u) => ({
      requestId: u.id,
      caseReference: localCases.find((c) => c.personId === u.requesterPersonId)?.reference ?? '',
      submittedAt: u.submittedAt.toISOString(),
    }));
  const myTasks = await deps.prisma.requestRoute.findMany({
    where: { assignedWorkerAccountId: staff.accountId, state: 'ASSIGNED', endedAt: null, assignedWorkerMembershipId: { in: staff.memberships.map((m) => m.id) } },
  });
  return {
    routeQueue,
    leadReview,
    matchingTasks: myTasks.map((t) => ({ routeId: t.id, assignedAt: t.assignedAt?.toISOString() ?? null })),
  };
}

