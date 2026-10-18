import { Router, type Request } from 'express';
import {
  assignmentCreateSchema,
  assistanceVerifySchema,
  caseReviewSchema,
  checkInCreateSchema,
  intakeSchema,
  leadUpdateSchema,
  proposeRecipientSchema,
  requestCreateSchema,
  respondSchema,
  routeAssignSchema,
  staffDeletePersonSchema,
  staffPrivacyUpdateSchema,
  transferAcceptSchema,
  transferProposeSchema,
} from '@rf/contracts';
import type { Deps } from '../deps.js';
import { requireActor } from '../auth/session.js';
import { idempotencyKey, isUuid, param, parseBody } from '../http/validate.js';
import { notFound } from '../lib/errors.js';
import { assistedAuthority, loadAssignedCase, requireVerified, type CaseScope } from '../policy/case.js';
import { requireStaff, type StaffContext } from '../policy/staff.js';
import {
  assignStaff,
  caseView,
  closeCase,
  eligibleStaff,
  endAssignment,
  endAssistance,
  escalate,
  extendCaseReview,
  intake,
  rotateAssistanceSecret,
  staffTasks,
  verifyAssistance,
} from '../services/cases.js';
import { createCheckIn, departCheckIn, toOwnCheckInDto } from '../services/checkins.js';
import { deletePerson } from '../services/deletion.js';
import { idempotent } from '../services/idempotency.js';
import { toNotificationDto } from '../services/notifications.js';
import { rotateContactCode, updatePrivacy } from '../services/people.js';
import { placeMaps } from '../services/places.js';
import { blockRequester, declineRequest, listIncoming, listOutgoing, respondToRequest, withdrawRequest } from '../services/requests.js';
import { askForLead, assignRoute, createRoutedRequest, listCandidates, markNoMatch, proposeRecipient, routeTaskView, routingQueues, updateLead } from '../services/routing.js';
import { getResponseForRecipient, listGrants, listSharedWithMe, revokeAllGrants, revokeGrant } from '../services/sharing.js';
import { acceptTransfer, cancelTransfer, incomingTransfers, proposeTransfer } from '../services/transfers.js';

/** Sections of the case view only shown with this worker's current verification. */
async function assistedSections(deps: Deps, scope: CaseScope) {
  const personId = scope.kase.personId;
  const [outgoing, incoming, grants, sharedWithMe, notes, transfer] = await Promise.all([
    listOutgoing(deps, personId),
    listIncoming(deps, personId),
    listGrants(deps, personId),
    listSharedWithMe(deps, personId),
    deps.prisma.notification.findMany({ where: { assistedCaseId: scope.kase.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    deps.prisma.caseTransfer.findFirst({ where: { caseId: scope.kase.id, state: 'PROPOSED' } }),
  ]);
  return {
    requests: { outgoing, incoming },
    grants,
    sharedWithMe,
    notifications: notes.map(toNotificationDto),
    pendingTransfer: transfer ? { transferId: transfer.id, toShelterId: transfer.toShelterId, createdAt: transfer.createdAt.toISOString() } : null,
  };
}

export function staffRoutes(deps: Deps): Router {
  const r = Router();
  const staffOf = (req: Request): Promise<StaffContext> => requireStaff(deps, requireActor(req));
  const idParam = (req: Request, name = 'id'): string => {
    const v = param(req, name);
    if (!isUuid(v)) throw notFound();
    return v;
  };
  /** Assigned + verified case authority for assisted actions. */
  const verifiedCase = async (req: Request) => {
    const staff = await staffOf(req);
    const scope = await loadAssignedCase(deps, staff, idParam(req));
    return { staff, scope, auth: assistedAuthority(scope, staff) };
  };

  /** Staff context summary: own memberships only, no person data. */
  r.get('/me', async (req, res) => {
    const staff = await staffOf(req);
    const shelters = await deps.prisma.shelter.findMany({
      where: { id: { in: staff.memberships.map((m) => m.shelterId).filter((x): x is string => !!x) } },
      select: { id: true, name: true },
    });
    res.json({
      memberships: staff.memberships.map((m) => ({
        role: m.role,
        shelter: m.shelterId ? { id: m.shelterId, name: shelters.find((s) => s.id === m.shelterId)?.name ?? '' } : null,
      })),
    });
  });

  r.get('/tasks', async (req, res) => {
    const staff = await staffOf(req);
    res.json(await staffTasks(deps, staff, async () => ({ ...(await routingQueues(deps, staff)), incomingTransfers: await incomingTransfers(deps, staff) })));
  });

  r.get('/shelters/:id/staff', async (req, res) => {
    const staff = await staffOf(req);
    res.json({ staff: await eligibleStaff(deps, staff, idParam(req)) });
  });

  // ------------------------------------------------------------ cases

  r.post('/cases', async (req, res) => {
    const staff = await staffOf(req);
    const input = parseBody(intakeSchema, req);
    const result = await intake(deps, staff, input, idempotencyKey(req));
    res.status(result.replayed ? 200 : 201).json(result.body);
  });

  r.get('/cases/:id', async (req, res) => {
    const staff = await staffOf(req);
    const scope = await loadAssignedCase(deps, staff, idParam(req));
    res.json(await caseView(deps, scope, (s) => assistedSections(deps, s)));
  });

  r.post('/cases/:id/verify', async (req, res) => {
    const staff = await staffOf(req);
    const input = parseBody(assistanceVerifySchema, req);
    res.json(await verifyAssistance(deps, staff, idParam(req), input.assistanceSecret));
  });

  r.post('/cases/:id/end-assistance', async (req, res) => {
    await endAssistance(deps, await staffOf(req), idParam(req));
    res.status(204).end();
  });

  r.post('/cases/:id/escalate', async (req, res) => {
    res.json(await escalate(deps, await staffOf(req), idParam(req)));
  });

  r.post('/cases/:id/assignments', async (req, res) => {
    const staff = await staffOf(req);
    const input = parseBody(assignmentCreateSchema, req);
    res.status(201).json(await assignStaff(deps, staff, idParam(req), input));
  });

  r.post('/cases/:id/assignments/:assignmentId/end', async (req, res) => {
    await endAssignment(deps, await staffOf(req), idParam(req), idParam(req, 'assignmentId'));
    res.status(204).end();
  });

  r.post('/cases/:id/close', async (req, res) => {
    await closeCase(deps, await staffOf(req), idParam(req));
    res.json({ status: 'CLOSED' });
  });

  r.post('/cases/:id/review', async (req, res) => {
    const staff = await staffOf(req);
    parseBody(caseReviewSchema, req);
    await extendCaseReview(deps, staff, idParam(req));
    res.json({ status: 'EXTENDED' });
  });

  r.post('/cases/:id/check-ins', async (req, res) => {
    const { staff, auth } = await verifiedCase(req);
    const input = parseBody(checkInCreateSchema, req);
    const key = idempotencyKey(req);
    const result = await idempotent(
      deps,
      { actorAccountId: staff.accountId, operation: 'checkin.create', subjectKey: auth.personId, key, payload: input },
      async (tx) => ({ outcomeType: 'CheckIn', outcomeId: (await createCheckIn(deps, tx, auth, input)).id }),
    );
    const row = await deps.prisma.checkIn.findFirstOrThrow({ where: { id: result.outcomeId, personId: auth.personId } });
    res.status(result.replayed ? 200 : 201).json({ checkIn: toOwnCheckInDto(row, await placeMaps(deps)) });
  });

  r.post('/cases/:id/check-ins/:checkInId/depart', async (req, res) => {
    const { auth } = await verifiedCase(req);
    const checkInId = idParam(req, 'checkInId');
    await departCheckIn(deps, auth, checkInId);
    const fresh = await deps.prisma.checkIn.findUniqueOrThrow({ where: { id: checkInId } });
    res.json({ checkIn: toOwnCheckInDto(fresh, await placeMaps(deps)) });
  });

  r.patch('/cases/:id/privacy', async (req, res) => {
    const { auth } = await verifiedCase(req);
    res.json(await updatePrivacy(deps, auth, parseBody(staffPrivacyUpdateSchema, req)));
  });

  r.post('/cases/:id/contact-code/rotate', async (req, res) => {
    const { auth } = await verifiedCase(req);
    res.status(201).json({ contactCode: await rotateContactCode(deps, auth) });
  });

  r.post('/cases/:id/assistance-secret/rotate', async (req, res) => {
    const { auth } = await verifiedCase(req);
    const person = await deps.prisma.person.findUniqueOrThrow({ where: { id: auth.personId } });
    if (person.restrictedReferral) throw notFound();
    res.status(201).json({ assistanceSecret: await rotateAssistanceSecret(deps, auth) });
  });

  r.delete('/cases/:id/person', async (req, res) => {
    const { auth } = await verifiedCase(req);
    parseBody(staffDeletePersonSchema, req);
    await deletePerson(deps, auth, 'ASSISTED');
    res.status(204).end();
  });

  // ------------------------------------------------------------ assisted requests and sharing

  r.get('/cases/:id/requests', async (req, res) => {
    const { auth } = await verifiedCase(req);
    res.json({ outgoing: await listOutgoing(deps, auth.personId), incoming: await listIncoming(deps, auth.personId) });
  });

  r.post('/cases/:id/requests', async (req, res) => {
    const { auth } = await verifiedCase(req);
    const input = parseBody(requestCreateSchema, req);
    const result = await createRoutedRequest(deps, auth, input, idempotencyKey(req));
    res.status(202).json({ status: 'submitted', requestId: result.requestId });
  });

  r.post('/cases/:id/requests/:requestId/respond', async (req, res) => {
    const { auth } = await verifiedCase(req);
    const input = parseBody(respondSchema, req);
    const result = await respondToRequest(deps, auth, idParam(req, 'requestId'), input, idempotencyKey(req));
    res.status(result.replayed ? 200 : 201).json(result.body);
  });

  r.post('/cases/:id/requests/:requestId/decline', async (req, res) => {
    const { auth } = await verifiedCase(req);
    await declineRequest(deps, auth, idParam(req, 'requestId'));
    res.json({ status: 'DECLINED' });
  });

  r.post('/cases/:id/requests/:requestId/block', async (req, res) => {
    const { auth } = await verifiedCase(req);
    await blockRequester(deps, auth, idParam(req, 'requestId'));
    res.json({ status: 'BLOCKED' });
  });

  r.post('/cases/:id/requests/:requestId/withdraw', async (req, res) => {
    const { auth } = await verifiedCase(req);
    await withdrawRequest(deps, auth, idParam(req, 'requestId'));
    res.json({ status: 'WITHDRAWN' });
  });

  r.post('/cases/:id/requests/:requestId/lead', async (req, res) => {
    const { auth } = await verifiedCase(req);
    await updateLead(deps, auth, idParam(req, 'requestId'), parseBody(leadUpdateSchema, req));
    res.json({ status: 'updated' });
  });

  r.get('/cases/:id/responses/:responseId', async (req, res) => {
    const { auth } = await verifiedCase(req);
    res.json(await getResponseForRecipient(deps, auth.personId, idParam(req, 'responseId')));
  });

  r.post('/cases/:id/grants/revoke-all', async (req, res) => {
    const { auth } = await verifiedCase(req);
    res.json({ revoked: await revokeAllGrants(deps, auth) });
  });

  r.post('/cases/:id/grants/:grantId/revoke', async (req, res) => {
    const { auth } = await verifiedCase(req);
    await revokeGrant(deps, auth, idParam(req, 'grantId'));
    res.json({ status: 'REVOKED' });
  });

  // ------------------------------------------------------------ transfers

  r.post('/cases/:id/transfers', async (req, res) => {
    const staff = await staffOf(req);
    const scope = await loadAssignedCase(deps, staff, idParam(req));
    requireVerified(scope);
    const input = parseBody(transferProposeSchema, req);
    res.status(201).json(await proposeTransfer(deps, staff, scope, input.toShelterId));
  });

  r.post('/transfers/:id/accept', async (req, res) => {
    const staff = await staffOf(req);
    await acceptTransfer(deps, staff, idParam(req), parseBody(transferAcceptSchema, req));
    res.json({ status: 'ACCEPTED' });
  });

  r.post('/transfers/:id/cancel', async (req, res) => {
    await cancelTransfer(deps, await staffOf(req), idParam(req));
    res.json({ status: 'CANCELLED' });
  });

  // ------------------------------------------------------------ no-code routing tasks

  r.post('/routes/:id/assign', async (req, res) => {
    const staff = await staffOf(req);
    await assignRoute(deps, staff, idParam(req), parseBody(routeAssignSchema, req).membershipId);
    res.json({ status: 'ASSIGNED' });
  });

  r.get('/routes/:id', async (req, res) => {
    res.json(await routeTaskView(deps, await staffOf(req), idParam(req)));
  });

  r.get('/routes/:id/candidates', async (req, res) => {
    res.json({ candidates: await listCandidates(deps, await staffOf(req), idParam(req)) });
  });

  r.post('/routes/:id/propose-recipient', async (req, res) => {
    const staff = await staffOf(req);
    await proposeRecipient(deps, staff, idParam(req), parseBody(proposeRecipientSchema, req).candidateToken);
    res.json({ status: 'proposed' });
  });

  r.post('/routes/:id/no-match', async (req, res) => {
    await markNoMatch(deps, await staffOf(req), idParam(req));
    res.json({ status: 'recorded' });
  });

  r.post('/requests/:id/ask-for-lead', async (req, res) => {
    await askForLead(deps, await staffOf(req), idParam(req));
    res.json({ status: 'asked' });
  });

  return r;
}
