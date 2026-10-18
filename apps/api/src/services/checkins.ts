import { Prisma, type CheckIn } from '@prisma/client';
import type { CheckInCreateInput, OwnCheckInDto } from '@rf/contracts';
import { FUTURE_TOLERANCE_MS } from '@rf/contracts';
import type { Deps } from '../deps.js';
import { conflict, forbidden, notFound, validation } from '../lib/errors.js';
import { DAY } from '../lib/clock.js';
import { audit } from './audit.js';
import type { SubjectAuthority } from './people.js';
import { placeMaps, type PlaceMaps } from './places.js';

const MAX_BACKDATE_MS = 30 * DAY;

/**
 * Creates a historical report for the authority's subject. The subject always comes
 * from the authority (session person or verified case), never from the request body.
 */
export async function createCheckIn(deps: Deps, tx: Prisma.TransactionClient, auth: SubjectAuthority, input: CheckInCreateInput): Promise<CheckIn> {
  const person = await tx.person.findUnique({ where: { id: auth.personId } });
  if (!person || person.deletedAt) throw notFound();
  if (person.restrictedReferral) throw forbidden('Restricted referrals do not record locations here. Use the referral process.');

  const now = deps.clock.now();
  const observedAt = new Date(input.observedAt);
  if (observedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw validation([{ path: 'observedAt', message: 'This time is in the future. Enter when the person was there.' }]);
  }
  if (observedAt.getTime() < now.getTime() - MAX_BACKDATE_MS) {
    throw validation([{ path: 'observedAt', message: 'Reports older than 30 days cannot be added.' }]);
  }

  let shelterId: string | null = null;
  let areaId: string;
  if (input.shelterId) {
    const shelter = await tx.shelter.findFirst({ where: { id: input.shelterId, incidentId: person.incidentId, state: 'OPEN' } });
    if (!shelter) throw validation([{ path: 'shelterId', message: 'Choose a shelter from the list.' }]);
    if (input.areaId && input.areaId !== shelter.areaId) throw validation([{ path: 'areaId', message: 'That shelter is not in the chosen area.' }]);
    shelterId = shelter.id;
    areaId = shelter.areaId;
  } else {
    const area = await tx.area.findFirst({ where: { id: input.areaId!, incidentId: person.incidentId } });
    if (!area) throw validation([{ path: 'areaId', message: 'Choose an area from the list.' }]);
    areaId = area.id;
  }

  if (input.supersedesId) {
    const locked = await tx.$queryRaw<{ id: string; state: string }[]>`
      SELECT "id", "state"::text AS "state" FROM "CheckIn" WHERE "id" = ${input.supersedesId}::uuid AND "personId" = ${auth.personId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound();
    if (locked[0]!.state !== 'ACTIVE') throw conflict('That report was already replaced or marked as left. Refresh and try again.');
    await tx.checkIn.update({ where: { id: input.supersedesId }, data: { state: 'SUPERSEDED' } });
  }

  let created: CheckIn;
  try {
    created = await tx.checkIn.create({
      data: {
        personId: auth.personId,
        incidentId: person.incidentId,
        shelterId,
        areaId,
        observedAt,
        receivedAt: now,
        authorAccountId: auth.actorAccountId,
        source: auth.authorityType === 'SELF' ? 'SELF_REPORT' : 'STAFF_RECORDED',
        createdViaCaseId: auth.authorityType === 'SELF' ? null : auth.caseId!,
        reportedStatus: input.reportedStatus,
        entryOrigin: input.entryOrigin,
        supersedesId: input.supersedesId ?? null,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('That report was already replaced.');
    throw e;
  }
  await audit(tx, {
    actorAccountId: auth.actorAccountId,
    action: 'checkin.create',
    objectType: 'CheckIn',
    objectId: created.id,
    authorityType: auth.authorityType,
    authorityId: auth.caseId ?? null,
    result: 'SUCCEEDED',
    at: now,
  });
  if (auth.caseId) await tx.assistanceCase.update({ where: { id: auth.caseId }, data: { lastActivityAt: now } });
  return created;
}

export async function departCheckIn(deps: Deps, auth: SubjectAuthority, checkInId: string): Promise<CheckIn> {
  const now = deps.clock.now();
  return deps.prisma.$transaction(async (tx) => {
    const updated = await tx.checkIn.updateMany({
      where: { id: checkInId, personId: auth.personId, state: 'ACTIVE' },
      data: { state: 'DEPARTED', departedAt: now },
    });
    const row = await tx.checkIn.findFirst({ where: { id: checkInId, personId: auth.personId } });
    if (!row) throw notFound();
    if (updated.count === 0) throw conflict('That report was already replaced or marked as left.');
    await audit(tx, {
      actorAccountId: auth.actorAccountId,
      action: 'checkin.depart',
      objectType: 'CheckIn',
      objectId: checkInId,
      authorityType: auth.authorityType,
      authorityId: auth.caseId ?? null,
      result: 'SUCCEEDED',
      at: now,
    });
    return row;
  });
}

export async function listOwnCheckIns(deps: Deps, personId: string): Promise<OwnCheckInDto[]> {
  const [rows, maps] = await Promise.all([
    deps.prisma.checkIn.findMany({ where: { personId }, orderBy: [{ observedAt: 'desc' }, { receivedAt: 'desc' }], take: 50 }),
    placeMaps(deps),
  ]);
  return rows.map((r) => toOwnCheckInDto(r, maps));
}

/** Subject's own full view (the person or their verified assisting worker). Explicit allowlist. */
export function toOwnCheckInDto(c: CheckIn, maps: PlaceMaps): OwnCheckInDto {
  const shelter = c.shelterId ? maps.shelters.get(c.shelterId) : undefined;
  const areaLabel = maps.areas.get(c.areaId) ?? '';
  return {
    id: c.id,
    place: shelter
      ? { kind: 'SHELTER', shelterId: c.shelterId!, shelterName: shelter.name, shelterAddress: shelter.publicAddress, areaId: c.areaId, areaLabel }
      : { kind: 'AREA', areaId: c.areaId, areaLabel },
    observedAt: c.observedAt.toISOString(),
    receivedAt: c.receivedAt.toISOString(),
    source: c.source === 'SELF_REPORT' ? 'self_report' : 'staff_recorded',
    state: c.state,
    reportedStatus: c.reportedStatus,
    entryOrigin: c.entryOrigin,
    supersedesId: c.supersedesId,
  };
}
