import { randomUUID } from 'node:crypto';
import type { Prisma, ReunionRequest } from '@prisma/client';
import type { IncomingRequestDto, OutgoingRequestDto, OutgoingStatus, RequestCreateInput, RespondInput } from '@rf/contracts';
import type { Deps } from '../deps.js';
import { enforce } from '../auth/rateLimit.js';
import { conflict, forbidden, notFound, validation } from '../lib/errors.js';
import { DAY, HOUR } from '../lib/clock.js';
import { isWellFormedSecret, normalizeSecret } from '../lib/secrets.js';
import { enqueue } from '../jobs/outbox.js';
import { audit } from './audit.js';
import { idempotent, isCompletedRetry } from './idempotency.js';
import { POLICY_VERSION, type SubjectAuthority } from './people.js';

export const REQUEST_TTL_MS = 14 * DAY;
const GRANT_TTL = { '24h': DAY, '7d': 7 * DAY } as const;

interface LockedRequest {
  id: string;
  incidentId: string;
  requesterPersonId: string;
  recipientPersonId: string | null;
  routeType: string;
  internalState: string;
  withdrawnAt: Date | null;
  deliveredAt: Date | null;
  expiresAt: Date;
  version: number;
}

/** Row lock that serializes approval, withdrawal, decline, block and routing on one request. */
export async function lockRequest(tx: Prisma.TransactionClient, requestId: string): Promise<LockedRequest | undefined> {
  const rows = await tx.$queryRaw<LockedRequest[]>`
    SELECT "id", "incidentId", "requesterPersonId", "recipientPersonId", "routeType"::text AS "routeType",
           "internalState"::text AS "internalState", "withdrawnAt", "deliveredAt", "expiresAt", "version"
    FROM "ReunionRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
  return rows[0];
}

function consentBase(auth: SubjectAuthority, now: Date) {
  return {
    actorAccountId: auth.actorAccountId,
    caseId: auth.caseId ?? null,
    assistanceSessionId: auth.assistanceSessionId ?? null,
    statedAt: now,
    recordedAt: now,
    policyVersion: POLICY_VERSION,
  };
}

function auditBase(auth: SubjectAuthority) {
  return { actorAccountId: auth.actorAccountId, authorityType: auth.authorityType, authorityId: auth.caseId ?? null };
}

/**
 * Creates a request owned by the authority's person. Code requests are resolved later by
 * the worker so the response never depends on whether the code matched anyone.
 * `onRouted` lets the routing service attach a shelter route in the same transaction.
 */
export async function createRequest(
  deps: Deps,
  auth: SubjectAuthority,
  input: RequestCreateInput,
  key: string,
  onRouted?: (tx: Prisma.TransactionClient, request: ReunionRequest) => Promise<void>,
): Promise<{ requestId: string; replayed: boolean }> {
  const person = await deps.prisma.person.findUnique({ where: { id: auth.personId } });
  if (!person || person.deletedAt) throw notFound();
  if (person.restrictedReferral) throw forbidden('Restricted referrals cannot send requests through this site.');
  if (input.routeType === 'CODE' && !isWellFormedSecret(input.contactCode)) {
    throw validation([{ path: 'contactCode', message: 'Check the contact code: it has 26 letters and numbers.' }]);
  }
  if (input.routeType === 'ROUTED' && input.destinationShelterId) {
    const shelter = await deps.prisma.shelter.findFirst({ where: { id: input.destinationShelterId, incidentId: person.incidentId, state: 'OPEN', isPublic: true } });
    if (!shelter) throw validation([{ path: 'destinationShelterId', message: 'Choose a shelter from the list.' }]);
  }
  // Target-independent limit: counted before any resolution happens. A retry of a saved request
  // (same key) is answered from its stored outcome and does not count as a new request.
  if (!(await isCompletedRetry(deps, { actorAccountId: auth.actorAccountId, operation: 'request.create', subjectKey: auth.personId, key }))) {
    await enforce(deps, `request-create:${auth.personId}`, deps.config.limits.requestsPerHour, HOUR);
  }

  const result = await idempotent(
    deps,
    { actorAccountId: auth.actorAccountId, operation: 'request.create', subjectKey: auth.personId, key, payload: input },
    async (tx) => {
      const now = deps.clock.now();
      const id = randomUUID();
      const routed = input.routeType === 'ROUTED';
      const request = await tx.reunionRequest.create({
        data: {
          id,
          incidentId: person.incidentId,
          requesterPersonId: person.id,
          routeType: input.routeType,
          codeDigest: input.routeType === 'CODE' ? deps.crypto.digest('contact-code', normalizeSecret(input.contactCode)) : null,
          requesterAliasSnapshot: person.alias,
          encryptedIntroduction: deps.crypto.encrypt(input.introduction, 'request.introduction', id),
          encryptedClues: routed && input.clues ? deps.crypto.encrypt(input.clues, 'request.clues', id) : null,
          internalState: routed ? 'UNRESOLVED' : 'SUBMITTED',
          submittedAt: now,
          expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
          createdByAccountId: auth.actorAccountId,
          createdViaCaseId: auth.caseId ?? null,
        },
      });
      if (input.routeType === 'CODE') {
        await enqueue(deps, tx, { kind: 'request.resolve', requestId: id }, `request.resolve:${id}`);
      } else if (onRouted) {
        await onRouted(tx, request);
      }
      await audit(tx, { ...auditBase(auth), action: 'request.create', objectType: 'ReunionRequest', objectId: id, result: 'SUCCEEDED', at: now });
      if (auth.caseId) await tx.assistanceCase.update({ where: { id: auth.caseId }, data: { lastActivityAt: now } });
      return { outcomeType: 'ReunionRequest', outcomeId: id };
    },
  );
  return { requestId: result.outcomeId, replayed: result.replayed };
}

function grantActive(g: { revokedAt: Date | null; expiresAt: Date } | null | undefined, now: Date): boolean {
  return !!g && !g.revokedAt && g.expiresAt > now;
}

type OutgoingRow = ReunionRequest & {
  response: { id: string; grant: { revokedAt: Date | null; expiresAt: Date } | null; subjectDeleted: boolean } | null;
  leadShelterName: string | null;
};

export function outgoingStatus(row: OutgoingRow, now: Date): OutgoingStatus {
  if (row.withdrawnAt) return 'WITHDRAWN';
  if (row.response) return grantActive(row.response.grant, now) && !row.response.subjectDeleted ? 'RESPONSE_AVAILABLE' : 'RESPONSE_UNAVAILABLE';
  if (now >= row.expiresAt) return 'EXPIRED';
  return 'NO_RESPONSE_YET';
}

/** Requester projection: hidden routing, matching, decline and block outcomes never appear. */
export function toOutgoingDto(deps: Deps, row: OutgoingRow, now: Date): OutgoingRequestDto {
  const status = outgoingStatus(row, now);
  return {
    id: row.id,
    routeType: row.routeType,
    submittedAt: row.submittedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    introduction: row.encryptedIntroduction ? deps.crypto.decrypt(row.encryptedIntroduction, 'request.introduction', row.id) : null,
    status,
    responseId: status === 'RESPONSE_AVAILABLE' ? row.response!.id : null,
    lead: row.leadShelterName ? { shelterName: row.leadShelterName } : null,
    version: row.version,
  };
}

async function loadOutgoingRows(deps: Deps, where: Prisma.ReunionRequestWhereInput): Promise<OutgoingRow[]> {
  const requests = await deps.prisma.reunionRequest.findMany({ where, orderBy: { submittedAt: 'desc' }, take: 50 });
  if (requests.length === 0) return [];
  const ids = requests.map((r) => r.id);
  const [responses, grants, routes] = await Promise.all([
    deps.prisma.response.findMany({ where: { requestId: { in: ids } } }),
    deps.prisma.sharingGrant.findMany({ where: { requestId: { in: ids } } }),
    deps.prisma.requestRoute.findMany({ where: { requestId: { in: ids } }, orderBy: { createdAt: 'desc' } }),
  ]);
  const subjects = await deps.prisma.person.findMany({ where: { id: { in: responses.map((r) => r.subjectPersonId) } }, select: { id: true, deletedAt: true } });
  const shelters = await deps.prisma.shelter.findMany({ where: { id: { in: routes.map((r) => r.destinationShelterId) } }, select: { id: true, name: true } });
  return requests.map((r) => {
    const resp = responses.find((x) => x.requestId === r.id);
    const route = routes.find((x) => x.requestId === r.id);
    return {
      ...r,
      response: resp
        ? { id: resp.id, grant: grants.find((g) => g.responseId === resp.id) ?? null, subjectDeleted: !!subjects.find((s) => s.id === resp.subjectPersonId)?.deletedAt }
        : null,
      leadShelterName: route ? (shelters.find((s) => s.id === route.destinationShelterId)?.name ?? null) : null,
    };
  });
}

export async function listOutgoing(deps: Deps, personId: string): Promise<OutgoingRequestDto[]> {
  const now = deps.clock.now();
  return (await loadOutgoingRows(deps, { requesterPersonId: personId })).map((r) => toOutgoingDto(deps, r, now));
}

function incomingStatus(r: ReunionRequest, now: Date): IncomingRequestDto['status'] {
  switch (r.internalState) {
    case 'RESPONDED':
      return 'RESPONDED';
    case 'DECLINED':
      return 'DECLINED';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'AWAITING_DECISION':
      return r.withdrawnAt || now >= r.expiresAt ? 'CLOSED' : 'AWAITING_DECISION';
    default:
      return 'CLOSED';
  }
}

/** Recipient projection: the requester's chosen alias and introduction only. */
export async function listIncoming(deps: Deps, personId: string, where: Prisma.ReunionRequestWhereInput = {}): Promise<IncomingRequestDto[]> {
  const now = deps.clock.now();
  const rows = await deps.prisma.reunionRequest.findMany({
    where: { ...where, recipientPersonId: personId, deliveredAt: { not: null } },
    orderBy: { deliveredAt: 'desc' },
    take: 50,
  });
  const responses = await deps.prisma.response.findMany({ where: { requestId: { in: rows.map((r) => r.id) } } });
  const grants = await deps.prisma.sharingGrant.findMany({ where: { responseId: { in: responses.map((r) => r.id) } } });
  return rows.map((r) => {
    const resp = responses.find((x) => x.requestId === r.id);
    const grant = resp ? grants.find((g) => g.responseId === resp.id) : undefined;
    return {
      id: r.id,
      requesterAlias: r.requesterAliasSnapshot,
      introduction: r.encryptedIntroduction ? deps.crypto.decrypt(r.encryptedIntroduction, 'request.introduction', r.id) : null,
      receivedAt: r.deliveredAt!.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      status: incomingStatus(r, now),
      version: r.version,
      yourResponse:
        resp && grant ? { scope: resp.scope, grantStatus: grant.revokedAt ? 'REVOKED' : grant.expiresAt <= now ? 'EXPIRED' : 'ACTIVE' } : null,
    };
  });
}

/** Participant-specific view of one request; anyone else gets the neutral 404. */
export async function getRequestForParticipant(deps: Deps, personId: string, requestId: string) {
  const r = await deps.prisma.reunionRequest.findUnique({ where: { id: requestId } });
  if (!r) throw notFound();
  if (r.requesterPersonId === personId) {
    const [row] = await loadOutgoingRows(deps, { id: requestId });
    return { role: 'REQUESTER' as const, request: toOutgoingDto(deps, row!, deps.clock.now()) };
  }
  if (r.recipientPersonId === personId && r.deliveredAt) {
    const [dto] = await listIncoming(deps, personId, { id: requestId });
    return { role: 'RECIPIENT' as const, request: dto! };
  }
  throw notFound();
}

export async function withdrawRequest(deps: Deps, auth: SubjectAuthority, requestId: string) {
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (!r || r.requesterPersonId !== auth.personId) throw notFound();
    if (r.withdrawnAt) return;
    if (r.internalState === 'RESPONDED') throw conflict('This request already has a response, so it cannot be withdrawn.');
    if (now >= r.expiresAt) throw conflict('This request has already expired.');
    await tx.reunionRequest.update({
      where: { id: requestId },
      data: { internalState: 'WITHDRAWN', withdrawnAt: now, closedAt: now, codeDigest: null, version: { increment: 1 } },
    });
    await tx.requestRoute.updateMany({ where: { requestId, endedAt: null }, data: { state: 'ENDED', endedAt: now } });
    await tx.consentRecord.create({ data: { ...consentBase(auth, now), personId: auth.personId, action: 'WITHDRAW', resourceId: requestId } });
    await audit(tx, { ...auditBase(auth), action: 'request.withdraw', objectType: 'ReunionRequest', objectId: requestId, result: 'SUCCEEDED', at: now });
  });
}

/** Private decline: the requester's view does not change. */
export async function declineRequest(deps: Deps, auth: SubjectAuthority, requestId: string) {
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (!r || r.recipientPersonId !== auth.personId || !r.deliveredAt) throw notFound();
    if (r.internalState !== 'AWAITING_DECISION' || r.withdrawnAt || now >= r.expiresAt) throw conflict('This request is no longer open.');
    await tx.reunionRequest.update({ where: { id: requestId }, data: { internalState: 'DECLINED', version: { increment: 1 } } });
    await tx.consentRecord.create({ data: { ...consentBase(auth, now), personId: auth.personId, action: 'DECLINE', resourceId: requestId, recipientPersonId: r.requesterPersonId } });
    await audit(tx, { ...auditBase(auth), action: 'request.decline', objectType: 'ReunionRequest', objectId: requestId, result: 'SUCCEEDED', at: now });
  });
}

/**
 * Directional block: revokes every existing grant from the subject to the requester,
 * closes their pending requests and suppresses later delivery. No notice is sent.
 */
export async function blockRequester(deps: Deps, auth: SubjectAuthority, requestId: string) {
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (!r || r.recipientPersonId !== auth.personId || !r.deliveredAt) throw notFound();
    await tx.block.createMany({ data: [{ subjectPersonId: auth.personId, blockedPersonId: r.requesterPersonId, createdAt: now }], skipDuplicates: true });
    await tx.sharingGrant.updateMany({
      where: { subjectPersonId: auth.personId, recipientPersonId: r.requesterPersonId, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'BLOCK' },
    });
    await tx.reunionRequest.updateMany({
      where: { requesterPersonId: r.requesterPersonId, recipientPersonId: auth.personId, internalState: 'AWAITING_DECISION' },
      data: { internalState: 'BLOCKED', version: { increment: 1 } },
    });
    await tx.consentRecord.create({ data: { ...consentBase(auth, now), personId: auth.personId, action: 'BLOCK', recipientPersonId: r.requesterPersonId, resourceId: requestId } });
    await audit(tx, { ...auditBase(auth), action: 'request.block', objectType: 'ReunionRequest', objectId: requestId, result: 'SUCCEEDED', at: now });
  });
}

/**
 * Recipient approval. In one transaction (request row locked): verify the request is
 * still awaiting this subject's decision, the subject's current state and the check-in's
 * ownership/scope, then write consent, immutable response, grant, audit and outbox event.
 */
export async function respondToRequest(deps: Deps, auth: SubjectAuthority, requestId: string, input: RespondInput, key: string) {
  const result = await idempotent(
    deps,
    { actorAccountId: auth.actorAccountId, operation: 'request.respond', subjectKey: requestId, key, payload: input },
    async (tx) => {
      const now = deps.clock.now();
      const r = await lockRequest(tx, requestId);
      if (!r || r.recipientPersonId !== auth.personId || !r.deliveredAt) throw notFound();
      if (r.internalState !== 'AWAITING_DECISION' || r.withdrawnAt || now >= r.expiresAt) throw conflict('This request can no longer be answered.');
      if (r.version !== input.expectedVersion) throw conflict('This request changed. Refresh and review it again.');
      const subjects = await tx.$queryRaw<{ id: string; alias: string; deletedAt: Date | null; restrictedReferral: boolean }[]>`
        SELECT "id", "alias", "deletedAt", "restrictedReferral" FROM "Person" WHERE "id" = ${auth.personId}::uuid FOR UPDATE`;
      const subject = subjects[0];
      if (!subject || subject.deletedAt) throw notFound();
      if (subject.restrictedReferral) throw forbidden('Restricted referrals cannot share information through this site.');
      const block = await tx.block.findUnique({ where: { subjectPersonId_blockedPersonId: { subjectPersonId: auth.personId, blockedPersonId: r.requesterPersonId } } });
      if (block) throw conflict('This request can no longer be answered.');

      let checkInId: string | null = null;
      if (input.scope !== 'SAFETY_MESSAGE') {
        const checkIn = await tx.checkIn.findFirst({ where: { id: input.checkInId!, personId: auth.personId, incidentId: r.incidentId } });
        if (!checkIn) throw validation([{ path: 'checkInId', message: 'Choose one of your own check-ins.' }]);
        if (checkIn.state !== 'ACTIVE') throw validation([{ path: 'checkInId', message: 'That report was replaced or marked as left. Choose a current one.' }]);
        if (input.scope === 'SHELTER' && !checkIn.shelterId) throw validation([{ path: 'scope', message: 'That check-in has no shelter. Share the area instead.' }]);
        checkInId = checkIn.id;
      }
      const consent = await tx.consentRecord.create({
        data: { ...consentBase(auth, now), personId: auth.personId, action: 'APPROVE_DISCLOSURE', scope: input.scope, recipientPersonId: r.requesterPersonId, resourceId: requestId },
      });
      const responseId = randomUUID();
      await tx.response.create({
        data: {
          id: responseId,
          requestId,
          subjectPersonId: auth.personId,
          scope: input.scope,
          statement: input.statement,
          encryptedMessage: input.message ? deps.crypto.encrypt(input.message, 'response.message', responseId) : null,
          checkInId,
          sharedAlias: subject.alias,
          consentId: consent.id,
          approvedAt: now,
          approvedByAccountId: auth.actorAccountId,
          viaCaseId: auth.caseId ?? null,
        },
      });
      await tx.sharingGrant.create({
        data: {
          responseId,
          requestId,
          subjectPersonId: auth.personId,
          recipientPersonId: r.requesterPersonId,
          scope: input.scope,
          checkInId,
          consentId: consent.id,
          createdAt: now,
          expiresAt: new Date(now.getTime() + GRANT_TTL[input.expiresIn]),
        },
      });
      await tx.reunionRequest.update({ where: { id: requestId }, data: { internalState: 'RESPONDED', version: { increment: 1 } } });
      await tx.requestRoute.updateMany({ where: { requestId, endedAt: null }, data: { state: 'ENDED', endedAt: now } });
      await audit(tx, { ...auditBase(auth), action: 'request.respond', objectType: 'Response', objectId: responseId, result: 'SUCCEEDED', at: now });
      await enqueue(deps, tx, { kind: 'response.notify', responseId }, `response.notify:${responseId}`);
      if (auth.caseId) await tx.assistanceCase.update({ where: { id: auth.caseId }, data: { lastActivityAt: now } });
      await deps.hooks?.beforeApprovalCommit?.();
      return { outcomeType: 'Response', outcomeId: responseId };
    },
  );
  const response = await deps.prisma.response.findUniqueOrThrow({ where: { id: result.outcomeId } });
  const grant = await deps.prisma.sharingGrant.findUniqueOrThrow({ where: { responseId: response.id } });
  return {
    replayed: result.replayed,
    body: { requestId, responseId: response.id, grantId: grant.id, scope: response.scope, expiresAt: grant.expiresAt.toISOString() },
  };
}
