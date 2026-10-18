import type { CheckIn, Response as ResponseRow, SharingGrant } from '@prisma/client';
import type { GrantDto, ResponseDto, ResponseLocationDto } from '@rf/contracts';
import type { Deps } from '../deps.js';
import { notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { POLICY_VERSION, type SubjectAuthority } from './people.js';
import { placeMaps, type PlaceMaps } from './places.js';

/**
 * Builds the recipient view field by field from the grant's scope. Nothing is spread
 * from database rows: AREA can never carry shelter fields, SAFETY_MESSAGE no location.
 */
export function toResponseDto(deps: Deps, response: ResponseRow, grant: SharingGrant, checkIn: CheckIn | null, maps: PlaceMaps): ResponseDto {
  const dto: ResponseDto = {
    responseId: response.id,
    scope: grant.scope,
    sharedAlias: response.sharedAlias,
    statement: response.statement,
    message: response.encryptedMessage ? deps.crypto.decrypt(response.encryptedMessage, 'response.message', response.id) : null,
    respondedAt: response.approvedAt.toISOString(),
    expiresAt: grant.expiresAt.toISOString(),
  };
  if (grant.scope !== 'SAFETY_MESSAGE' && checkIn) {
    const location: ResponseLocationDto = {
      kind: grant.scope === 'SHELTER' ? 'SHELTER' : 'AREA',
      areaLabel: maps.areas.get(checkIn.areaId) ?? '',
      observedAt: checkIn.observedAt.toISOString(),
      source: checkIn.source === 'SELF_REPORT' ? 'self_report' : 'staff_recorded',
      reportStatus: checkIn.state === 'ACTIVE' ? 'AS_REPORTED' : 'NO_LONGER_CURRENT',
    };
    if (grant.scope === 'SHELTER' && checkIn.shelterId) {
      const shelter = maps.shelters.get(checkIn.shelterId);
      location.shelterName = shelter?.name ?? '';
      location.shelterAddress = shelter?.publicAddress ?? '';
    }
    dto.location = location;
  }
  return dto;
}

/** response.read: an unexpired, unrevoked grant naming this viewer, rechecked on every read. */
export async function getResponseForRecipient(deps: Deps, viewerPersonId: string, responseId: string): Promise<ResponseDto> {
  const now = deps.clock.now();
  const grant = await deps.prisma.sharingGrant.findFirst({
    where: { responseId, recipientPersonId: viewerPersonId, revokedAt: null, expiresAt: { gt: now } },
  });
  if (!grant) throw notFound();
  const [response, subject] = await Promise.all([
    deps.prisma.response.findUniqueOrThrow({ where: { id: responseId } }),
    deps.prisma.person.findUnique({ where: { id: grant.subjectPersonId }, select: { deletedAt: true } }),
  ]);
  if (!subject || subject.deletedAt) throw notFound();
  const checkIn = grant.checkInId ? await deps.prisma.checkIn.findUnique({ where: { id: grant.checkInId } }) : null;
  if (grant.scope !== 'SAFETY_MESSAGE' && !checkIn) throw notFound();
  return toResponseDto(deps, response, grant, checkIn, await placeMaps(deps));
}

export async function listSharedWithMe(deps: Deps, viewerPersonId: string) {
  const now = deps.clock.now();
  const grants = await deps.prisma.sharingGrant.findMany({
    where: { recipientPersonId: viewerPersonId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const responses = await deps.prisma.response.findMany({ where: { id: { in: grants.map((g) => g.responseId) } } });
  const deleted = await deps.prisma.person.findMany({ where: { id: { in: grants.map((g) => g.subjectPersonId) }, deletedAt: { not: null } }, select: { id: true } });
  return grants
    .filter((g) => !deleted.some((d) => d.id === g.subjectPersonId))
    .map((g) => {
      const r = responses.find((x) => x.id === g.responseId)!;
      return { responseId: r.id, sharedAlias: r.sharedAlias, scope: g.scope, respondedAt: r.approvedAt.toISOString(), expiresAt: g.expiresAt.toISOString() };
    });
}

/** The subject's own sharing history: who received what, and its current state. */
export async function listGrants(deps: Deps, subjectPersonId: string): Promise<GrantDto[]> {
  const now = deps.clock.now();
  const grants = await deps.prisma.sharingGrant.findMany({ where: { subjectPersonId }, orderBy: { createdAt: 'desc' }, take: 100 });
  const [requests, checkIns, maps] = await Promise.all([
    deps.prisma.reunionRequest.findMany({ where: { id: { in: grants.map((g) => g.requestId) } }, select: { id: true, requesterAliasSnapshot: true } }),
    deps.prisma.checkIn.findMany({ where: { id: { in: grants.map((g) => g.checkInId).filter((x): x is string => !!x) } } }),
    placeMaps(deps),
  ]);
  return grants.map((g) => {
    const c = checkIns.find((x) => x.id === g.checkInId);
    let sharedPlace: string | null = null;
    if (c) sharedPlace = g.scope === 'SHELTER' && c.shelterId ? (maps.shelters.get(c.shelterId)?.name ?? '') : `Area: ${maps.areas.get(c.areaId) ?? ''}`;
    return {
      grantId: g.id,
      recipientAlias: requests.find((r) => r.id === g.requestId)?.requesterAliasSnapshot ?? '',
      scope: g.scope,
      sharedPlace,
      createdAt: g.createdAt.toISOString(),
      expiresAt: g.expiresAt.toISOString(),
      status: g.revokedAt ? 'REVOKED' : g.expiresAt <= now ? 'EXPIRED' : 'ACTIVE',
    };
  });
}

/** grant.revoke: subject only; idempotent; later reads deny. Copies already made cannot be recalled. */
export async function revokeGrant(deps: Deps, auth: SubjectAuthority, grantId: string) {
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    const grant = await tx.sharingGrant.findFirst({ where: { id: grantId, subjectPersonId: auth.personId } });
    if (!grant) throw notFound();
    if (grant.revokedAt) return;
    await tx.sharingGrant.update({ where: { id: grantId }, data: { revokedAt: now, revokedReason: 'SUBJECT' } });
    await tx.consentRecord.create({
      data: {
        personId: auth.personId,
        actorAccountId: auth.actorAccountId,
        caseId: auth.caseId ?? null,
        assistanceSessionId: auth.assistanceSessionId ?? null,
        action: 'REVOKE_GRANT',
        resourceId: grantId,
        recipientPersonId: grant.recipientPersonId,
        statedAt: now,
        recordedAt: now,
        policyVersion: POLICY_VERSION,
      },
    });
    await audit(tx, { actorAccountId: auth.actorAccountId, action: 'grant.revoke', objectType: 'SharingGrant', objectId: grantId, authorityType: auth.authorityType, authorityId: auth.caseId ?? null, result: 'SUCCEEDED', at: now });
  });
}

export async function revokeAllGrants(deps: Deps, auth: SubjectAuthority): Promise<number> {
  const now = deps.clock.now();
  return deps.prisma.$transaction(async (tx) => {
    const res = await tx.sharingGrant.updateMany({ where: { subjectPersonId: auth.personId, revokedAt: null }, data: { revokedAt: now, revokedReason: 'SUBJECT_ALL' } });
    await tx.consentRecord.create({
      data: {
        personId: auth.personId,
        actorAccountId: auth.actorAccountId,
        caseId: auth.caseId ?? null,
        assistanceSessionId: auth.assistanceSessionId ?? null,
        action: 'REVOKE_ALL',
        detail: String(res.count),
        statedAt: now,
        recordedAt: now,
        policyVersion: POLICY_VERSION,
      },
    });
    await audit(tx, { actorAccountId: auth.actorAccountId, action: 'grant.revokeAll', objectType: 'Person', objectId: auth.personId, authorityType: auth.authorityType, authorityId: auth.caseId ?? null, result: 'SUCCEEDED', at: now });
    return res.count;
  });
}

/** Abuse report about a record the reporter can legitimately reference. No other data is attached. */
export async function createAbuseReport(deps: Deps, auth: SubjectAuthority, input: { requestId?: string; responseId?: string; category: 'HARASSMENT' | 'IMPERSONATION' | 'UNSAFE_CONTENT' | 'OTHER' }) {
  const now = deps.clock.now();
  if (input.requestId) {
    const r = await deps.prisma.reunionRequest.findUnique({ where: { id: input.requestId } });
    const participant = r && (r.requesterPersonId === auth.personId || (r.recipientPersonId === auth.personId && r.deliveredAt));
    if (!participant) throw notFound();
  } else {
    const g = await deps.prisma.sharingGrant.findFirst({ where: { responseId: input.responseId!, OR: [{ recipientPersonId: auth.personId }, { subjectPersonId: auth.personId }] } });
    if (!g) throw notFound();
  }
  const report = await deps.prisma.abuseReport.create({
    data: { reporterPersonId: auth.personId, reporterAccountId: auth.actorAccountId, requestId: input.requestId ?? null, responseId: input.responseId ?? null, category: input.category, createdAt: now },
  });
  await audit(deps.prisma, { actorAccountId: auth.actorAccountId, action: 'abuse.report', objectType: 'AbuseReport', objectId: report.id, authorityType: auth.authorityType, result: 'SUCCEEDED', at: now });
  return { reportId: report.id };
}
