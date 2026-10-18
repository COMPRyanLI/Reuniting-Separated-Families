/**
 * Deterministic synthetic benchmark dataset (fictional, generated): 10,000 people,
 * 50 shelters, 30,000 check-ins, 20,000 requests and 5,000 grants, mixing incidents,
 * permissions, expired/revoked grants, unassigned cases and opted-in/closed profiles.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AppCrypto } from '../../apps/api/src/lib/crypto.js';
import { hashPassword } from '../../apps/api/src/auth/password.js';
import { generateSecret, normalizeSecret } from '../../apps/api/src/lib/secrets.js';
import { fixtureId } from '../../prisma/fixtures.js';

export const SIZES = { persons: 10_000, shelters: 50, checkIns: 30_000, requests: 20_000, grants: 5_000 } as const;
export const PERF_PASSWORD = 'perf-only-password-not-secret';

// Small deterministic PRNG so runs are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export interface Dataset {
  benchAccounts: { accountId: string; personId: string; username: string; credentialVersion: number }[];
  staffAccounts: { accountId: string; shelterId: string }[];
  activeGrants: { viewerPersonId: string; responseId: string }[];
  contactCodes: string[];
  shelterIds: string[];
  areaIds: string[];
}

async function chunked<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export async function buildDataset(prisma: PrismaClient, crypto: AppCrypto, now: Date): Promise<Dataset> {
  const rand = rng(42);
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)]!;
  const incident1 = fixtureId('incident:demo-hurricane-1');
  const incident2 = fixtureId('incident:demo-boundary-2');
  const passwordHash = await hashPassword(PERF_PASSWORD);

  // Places: extra areas and shelters up to 50 shelters in total.
  const existingShelters = await prisma.shelter.findMany();
  const areas: { id: string; incidentId: string; label: string }[] = [];
  for (let i = 0; i < 20; i++) areas.push({ id: randomUUID(), incidentId: i < 17 ? incident1 : incident2, label: `Perf Area ${i}` });
  await prisma.area.createMany({ data: areas });
  const shelters: Prisma.ShelterCreateManyInput[] = [];
  for (let i = existingShelters.length; i < SIZES.shelters; i++) {
    const area = areas[i % areas.length]!;
    shelters.push({ id: randomUUID(), incidentId: area.incidentId, areaId: area.id, name: `Perf Shelter ${i}`, publicAddress: `${i} Synthetic Way` });
  }
  await prisma.shelter.createMany({ data: shelters });
  const allShelters = await prisma.shelter.findMany();
  const sheltersByIncident = (inc: string) => allShelters.filter((s) => s.incidentId === inc);

  // Staff: one coordinator and two workers per synthetic shelter in incident 1.
  const staffAccounts: Dataset['staffAccounts'] = [];
  const memberships: Prisma.StaffMembershipCreateManyInput[] = [];
  const staffAcctRows: Prisma.AccountCreateManyInput[] = [];
  for (const s of sheltersByIncident(incident1).slice(0, 20)) {
    for (const role of ['COORDINATOR', 'WORKER', 'WORKER'] as const) {
      const id = randomUUID();
      staffAcctRows.push({ id, normalizedUsername: `perf.staff.${staffAcctRows.length}`, passwordHash, createdAt: now });
      memberships.push({ id: randomUUID(), accountId: id, incidentId: incident1, shelterId: s.id, role, createdAt: now });
      if (role === 'WORKER') staffAccounts.push({ accountId: id, shelterId: s.id });
    }
  }
  await prisma.account.createMany({ data: staffAcctRows });
  await prisma.staffMembership.createMany({ data: memberships });

  // People: 4,000 with accounts, 6,000 assisted (cases, many unassigned); 10% in incident 2.
  const persons: { id: string; incidentId: string; accountId: string | null; mode: 'CLOSED' | 'CODE_ONLY' | 'ASSISTED' }[] = [];
  const accounts: Prisma.AccountCreateManyInput[] = [];
  const personRows: Prisma.PersonCreateManyInput[] = [];
  for (let i = 0; i < SIZES.persons; i++) {
    const incidentId = i % 10 === 9 ? incident2 : incident1;
    const withAccount = i < 4_000;
    const accountId = withAccount ? randomUUID() : null;
    if (accountId) accounts.push({ id: accountId, normalizedUsername: `perf.user.${i}`, passwordHash, createdAt: now });
    const r = rand();
    const mode = r < 0.2 ? 'CLOSED' : r < 0.6 ? 'CODE_ONLY' : 'ASSISTED';
    const id = randomUUID();
    persons.push({ id, incidentId, accountId, mode });
    personRows.push({ id, accountId, incidentId, alias: `Perf Person ${i}`, requestMode: mode, createdAt: now });
  }
  await chunked(accounts, 2_000, (c) => prisma.account.createMany({ data: c }));
  await chunked(personRows, 2_000, (c) => prisma.person.createMany({ data: c }));
  const cases: Prisma.AssistanceCaseCreateManyInput[] = [];
  const assignments: Prisma.CaseAssignmentCreateManyInput[] = [];
  persons.forEach((p, i) => {
    if (p.accountId) return;
    const shelter = pick(sheltersByIncident(p.incidentId));
    const caseId = randomUUID();
    cases.push({ id: caseId, personId: p.id, incidentId: p.incidentId, shelterId: shelter.id, reference: `PERF-${i}`, createdAt: now, lastActivityAt: now });
    const worker = staffAccounts.find((s) => s.shelterId === shelter.id);
    if (worker && rand() < 0.5) {
      const m = memberships.find((x) => x.accountId === worker.accountId)!;
      assignments.push({ caseId, incidentId: p.incidentId, membershipId: m.id!, staffAccountId: worker.accountId, purposes: ['ASSIST'], startsAt: now, assignedByAccountId: worker.accountId });
    }
  });
  await chunked(cases, 2_000, (c) => prisma.assistanceCase.createMany({ data: c }));
  await chunked(assignments, 2_000, (c) => prisma.caseAssignment.createMany({ data: c }));

  const caseByPerson = new Map(cases.map((c) => [c.personId, c.id!]));
  // Check-ins: 3 per person; shelter reports carry their area.
  const checkIns: Prisma.CheckInCreateManyInput[] = [];
  const shelterCheckInOf = new Map<string, string>();
  for (const p of persons) {
    for (let k = 0; k < SIZES.checkIns / SIZES.persons; k++) {
      const s = pick(sheltersByIncident(p.incidentId));
      const id = randomUUID();
      const observedAt = new Date(now.getTime() - Math.floor(rand() * 72) * 3_600_000);
      checkIns.push({
        id,
        personId: p.id,
        incidentId: p.incidentId,
        shelterId: s.id,
        areaId: s.areaId,
        observedAt,
        receivedAt: observedAt,
        authorAccountId: p.accountId ?? staffAccounts[0]!.accountId,
        source: p.accountId ? 'SELF_REPORT' : 'STAFF_RECORDED',
        createdViaCaseId: p.accountId ? null : (caseByPerson.get(p.id) ?? null),
      });
      if (!shelterCheckInOf.has(p.id)) shelterCheckInOf.set(p.id, id);
    }
  }
  // Staff-recorded check-ins need a case; drop any that have none (incident mismatch guard).
  const validCheckIns = checkIns.filter((c) => c.source === 'SELF_REPORT' || c.createdViaCaseId);
  await chunked(validCheckIns, 3_000, (c) => prisma.checkIn.createMany({ data: c }));

  // Requests between people of the same incident. Benchmark accounts (first 200 with
  // accounts, incident 1) are requesters and recipients often.
  const inc1 = persons.filter((p) => p.incidentId === incident1);
  const bench = persons.filter((p) => p.accountId && p.incidentId === incident1).slice(0, 200);
  const requests: Prisma.ReunionRequestCreateManyInput[] = [];
  const responses: Prisma.ResponseCreateManyInput[] = [];
  const grants: Prisma.SharingGrantCreateManyInput[] = [];
  const consents: Prisma.ConsentRecordCreateManyInput[] = [];
  const activeGrants: Dataset['activeGrants'] = [];
  let grantCount = 0;
  for (let i = 0; i < SIZES.requests; i++) {
    const requester = i % 4 === 0 ? pick(bench) : pick(inc1);
    let recipient = i % 5 === 0 ? pick(bench) : pick(inc1);
    if (recipient.id === requester.id) recipient = inc1[(inc1.indexOf(requester) + 1) % inc1.length]!;
    const id = randomUUID();
    const submittedAt = new Date(now.getTime() - Math.floor(rand() * 10 * 86_400_000));
    const r = rand();
    const respond = grantCount < SIZES.grants && r < 0.3 && shelterCheckInOf.has(recipient.id);
    const state = respond ? 'RESPONDED' : r < 0.6 ? 'AWAITING_DECISION' : r < 0.75 ? 'UNRESOLVED' : r < 0.9 ? 'DECLINED' : 'WITHDRAWN';
    requests.push({
      id,
      incidentId: incident1,
      requesterPersonId: requester.id,
      recipientPersonId: state === 'UNRESOLVED' || state === 'WITHDRAWN' ? null : recipient.id,
      routeType: 'CODE',
      requesterAliasSnapshot: 'Perf requester',
      encryptedIntroduction: crypto.encrypt('Synthetic benchmark introduction', 'request.introduction', id),
      internalState: state,
      submittedAt,
      expiresAt: new Date(submittedAt.getTime() + 14 * 86_400_000),
      deliveredAt: state === 'UNRESOLVED' || state === 'WITHDRAWN' ? null : submittedAt,
      withdrawnAt: state === 'WITHDRAWN' ? submittedAt : null,
      createdByAccountId: requester.accountId ?? staffAccounts[0]!.accountId,
    });
    if (respond) {
      grantCount++;
      const consentId = randomUUID();
      const responseId = randomUUID();
      const scopes = ['SAFETY_MESSAGE', 'AREA', 'SHELTER'] as const;
      const scope = scopes[grantCount % 3]!;
      const checkInId = scope === 'SAFETY_MESSAGE' ? null : shelterCheckInOf.get(recipient.id)!;
      const kind = rand();
      const expired = kind < 0.15;
      const revoked = !expired && kind < 0.25;
      consents.push({ id: consentId, personId: recipient.id, actorAccountId: recipient.accountId ?? staffAccounts[0]!.accountId, action: 'APPROVE_DISCLOSURE', scope, recipientPersonId: requester.id, resourceId: id, statedAt: submittedAt, recordedAt: submittedAt, policyVersion: 'perf' });
      responses.push({ id: responseId, requestId: id, subjectPersonId: recipient.id, scope, statement: 'REPORTED_OK', checkInId, sharedAlias: 'Perf responder', consentId, approvedAt: submittedAt, approvedByAccountId: recipient.accountId ?? staffAccounts[0]!.accountId });
      grants.push({
        responseId,
        requestId: id,
        subjectPersonId: recipient.id,
        recipientPersonId: requester.id,
        scope,
        checkInId,
        consentId,
        createdAt: expired ? new Date(now.getTime() - 9 * 86_400_000) : now,
        expiresAt: expired ? new Date(now.getTime() - 2 * 86_400_000) : new Date(now.getTime() + 7 * 86_400_000 - 60_000),
        revokedAt: revoked ? now : null,
      });
      if (!expired && !revoked && bench.some((b) => b.id === requester.id)) activeGrants.push({ viewerPersonId: requester.id, responseId });
    }
  }
  await chunked(requests, 2_000, (c) => prisma.reunionRequest.createMany({ data: c }));
  await chunked(consents, 2_000, (c) => prisma.consentRecord.createMany({ data: c }));
  await chunked(responses, 2_000, (c) => prisma.response.createMany({ data: c }));
  await chunked(grants, 2_000, (c) => prisma.sharingGrant.createMany({ data: c }));

  // Contact codes for 500 open recipients, used by request writes during the load.
  const codes: string[] = [];
  const codeRows: Prisma.ContactCodeCreateManyInput[] = [];
  for (const p of inc1.filter((x) => x.mode !== 'CLOSED').slice(0, 500)) {
    const code = generateSecret();
    codes.push(code);
    codeRows.push({ personId: p.id, digest: crypto.digest('contact-code', normalizeSecret(code)), createdAt: now });
  }
  await prisma.contactCode.createMany({ data: codeRows });

  const benchAccounts = await prisma.account.findMany({ where: { id: { in: bench.map((b) => b.accountId!) } }, select: { id: true, normalizedUsername: true, credentialVersion: true, person: { select: { id: true } } } });
  return {
    benchAccounts: benchAccounts.map((a) => ({ accountId: a.id, personId: a.person!.id, username: a.normalizedUsername, credentialVersion: a.credentialVersion })),
    staffAccounts,
    activeGrants,
    contactCodes: codes,
    shelterIds: sheltersByIncident(incident1).map((s) => s.id),
    areaIds: areas.filter((a) => a.incidentId === incident1).map((a) => a.id),
  };
}
