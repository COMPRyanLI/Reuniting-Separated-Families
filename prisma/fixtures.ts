/**
 * Deterministic FICTIONAL fixtures. Every person, shelter and address here is invented.
 * Re-running the seed creates nothing new (DB-01): rows use stable IDs derived from labels.
 * A fixture person deleted since an earlier seed is skipped, so purged content never returns.
 */
import { createHash, createHmac } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/auth/password.js';
import type { AppCrypto } from '../apps/api/src/lib/crypto.js';
import { normalizeSecret } from '../apps/api/src/lib/secrets.js';

export function fixtureId(label: string): string {
  const h = createHash('sha256').update(`rf-fixture:${label}`).digest('hex');
  // Format as an RFC 4122 version-4-shaped UUID (deterministic, not random).
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Deterministic, well-formed demo secret derived from SEED_SECRET. Local/demo use only. */
export function demoSecret(seedSecret: string, label: string): string {
  const bytes = createHmac('sha256', seedSecret).update(`demo-secret:${label}`).digest();
  let s = '';
  for (let i = 0; i < 26; i++) s += ALPHABET[bytes[i]! & 31];
  return s.match(/.{1,4}/g)!.join('-');
}

export function demoCaseReference(seedSecret: string, label: string): string {
  const bytes = createHmac('sha256', seedSecret).update(`demo-ref:${label}`).digest();
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i]! & 31];
  return `REF-${s.slice(0, 4)}-${s.slice(4)}`;
}

export const INCIDENT_1 = 'demo-hurricane-1';
export const INCIDENT_2 = 'demo-boundary-2';

export const SHELTERS = {
  A: { label: 'shelter-a', name: 'Riverside Community Center', area: 'North Riverside', address: '100 Example Avenue, Fictional City', incident: INCIDENT_1 },
  B: { label: 'shelter-b', name: 'Hillcrest School Gym', area: 'Hillcrest', address: '42 Sample Road, Fictional City', incident: INCIDENT_1 },
  D: { label: 'shelter-d', name: 'Lakeside Church Hall', area: 'Lakeside', address: '7 Placeholder Lane, Fictional City', incident: INCIDENT_1 },
  X: { label: 'shelter-x', name: 'Bayview Hall', area: 'Bayview', address: '9 Boundary Street, Other Town', incident: INCIDENT_2 },
} as const;
export const EXTRA_AREAS = ['Downtown', 'East Marsh', 'Airport Road'] as const;

export const INDIVIDUALS = {
  maya: { username: 'maya', alias: 'Maya R.' },
  leo: { username: 'leo', alias: 'Leo (Maya’s brother)' },
  noor: { username: 'noor', alias: 'Noor' },
  evan: { username: 'evan', alias: 'Evan' },
} as const;

export type StaffKey = 'wA' | 'wA2' | 'wB' | 'cA' | 'cB' | 'op' | 'wX';
export const STAFF: Record<StaffKey, { username: string; role: 'WORKER' | 'COORDINATOR' | 'OPERATOR'; shelter: keyof typeof SHELTERS | null; incident: string }> = {
  wA: { username: 'worker.a', role: 'WORKER', shelter: 'A', incident: INCIDENT_1 },
  wA2: { username: 'worker.a2', role: 'WORKER', shelter: 'A', incident: INCIDENT_1 },
  wB: { username: 'worker.b', role: 'WORKER', shelter: 'B', incident: INCIDENT_1 },
  cA: { username: 'coord.a', role: 'COORDINATOR', shelter: 'A', incident: INCIDENT_1 },
  cB: { username: 'coord.b', role: 'COORDINATOR', shelter: 'B', incident: INCIDENT_1 },
  op: { username: 'operator.o', role: 'OPERATOR', shelter: null, incident: INCIDENT_1 },
  wX: { username: 'worker.x', role: 'WORKER', shelter: 'X', incident: INCIDENT_2 },
};

/** Assisted people without accounts. `assignee` is the initially assigned worker. */
export const ASSISTED = {
  sam: { alias: 'Sam', shelter: 'A', mode: 'CODE_ONLY', restricted: false, clue: null, assignee: 'wA' },
  r: { alias: 'R (referral)', shelter: 'A', mode: 'CLOSED', restricted: true, clue: null, assignee: 'wA' },
  ana: { alias: 'Ana', shelter: 'B', mode: 'ASSISTED', restricted: false, clue: 'Grey cap, mentions sister Maya', assignee: 'wB' },
  bo: { alias: 'Bo', shelter: 'B', mode: 'CODE_ONLY', restricted: false, clue: null, assignee: 'wB' },
  cy: { alias: 'Cy', shelter: 'B', mode: 'CLOSED', restricted: false, clue: null, assignee: 'wB' },
  kit: { alias: 'Kit', shelter: 'X', mode: 'ASSISTED', restricted: false, clue: 'Other incident boundary fixture', assignee: 'wX' },
} as const satisfies Record<string, { alias: string; shelter: keyof typeof SHELTERS; mode: 'CLOSED' | 'CODE_ONLY' | 'ASSISTED'; restricted: boolean; clue: string | null; assignee: StaffKey }>;
export type AssistedKey = keyof typeof ASSISTED;

export interface SeedOptions {
  now: Date;
  seedPassword: string;
  seedSecret: string;
  crypto: AppCrypto;
}

export interface SeedSummary {
  accounts: number;
  memberships: number;
  cases: number;
}

/** Set by every completed seed; startup seeding (`seed.ts --once`) skips a database that has it. */
export const FIXTURES_SEEDED_FLAG = 'demo_fixtures_seeded';

/** Seeds only a database that has never been seeded; returns null when it was skipped. */
export async function seedFixturesOnce(prisma: PrismaClient, opts: SeedOptions): Promise<SeedSummary | null> {
  if (await prisma.systemFlag.findUnique({ where: { key: FIXTURES_SEEDED_FLAG } })) return null;
  return seedFixtures(prisma, opts);
}

export async function seedFixtures(prisma: PrismaClient, opts: SeedOptions): Promise<SeedSummary> {
  const { now } = opts;
  // Deleted people keep only a tombstone: never recreate their check-ins, credentials or cases.
  const retired = new Set<string>([
    ...(await prisma.person.findMany({ where: { deletedAt: { not: null } }, select: { id: true } })).map((p) => p.id),
    ...(await prisma.deletionTombstone.findMany({ select: { personRef: true } })).map((t) => t.personRef),
  ]);
  const incidentIds: Record<string, string> = {};
  for (const [slug, label] of [
    [INCIDENT_1, 'Demo Hurricane (fictional)'],
    [INCIDENT_2, 'Boundary test incident (fictional)'],
  ] as const) {
    const id = fixtureId(`incident:${slug}`);
    await prisma.incident.upsert({ where: { id }, update: {}, create: { id, slug, label } });
    incidentIds[slug] = id;
  }

  const areaIds: Record<string, string> = {};
  const areaSpecs: [string, string][] = [
    ...Object.values(SHELTERS).map((s) => [s.incident, s.area] as [string, string]),
    ...EXTRA_AREAS.map((a) => [INCIDENT_1, a] as [string, string]),
  ];
  for (const [incident, label] of areaSpecs) {
    const id = fixtureId(`area:${incident}:${label}`);
    await prisma.area.upsert({ where: { id }, update: {}, create: { id, incidentId: incidentIds[incident]!, label } });
    areaIds[`${incident}:${label}`] = id;
  }

  const shelterIds: Record<string, string> = {};
  for (const [key, s] of Object.entries(SHELTERS)) {
    const id = fixtureId(`shelter:${s.label}`);
    await prisma.shelter.upsert({
      where: { id },
      update: {},
      create: {
        id,
        incidentId: incidentIds[s.incident]!,
        areaId: areaIds[`${s.incident}:${s.area}`]!,
        name: s.name,
        publicAddress: s.address,
      },
    });
    shelterIds[key] = id;
  }

  const passwordHash = await hashPassword(opts.seedPassword);
  const accountIds: Record<string, string> = {};
  async function upsertAccount(username: string) {
    const id = fixtureId(`account:${username}`);
    await prisma.account.upsert({
      where: { id },
      update: {},
      create: { id, normalizedUsername: username, passwordHash, createdAt: now },
    });
    accountIds[username] = id;
    return id;
  }

  for (const ind of Object.values(INDIVIDUALS)) {
    const personId = fixtureId(`person:${ind.username}`);
    if (retired.has(personId)) continue;
    const accountId = await upsertAccount(ind.username);
    await prisma.person.upsert({
      where: { id: personId },
      update: {},
      create: { id: personId, accountId, incidentId: incidentIds[INCIDENT_1]!, alias: ind.alias, createdAt: now },
    });
  }

  const membershipIds: Partial<Record<StaffKey, string>> = {};
  for (const [key, st] of Object.entries(STAFF) as [StaffKey, (typeof STAFF)[StaffKey]][]) {
    const accountId = await upsertAccount(st.username);
    const id = fixtureId(`membership:${st.username}`);
    await prisma.staffMembership.upsert({
      where: { id },
      update: {},
      create: {
        id,
        accountId,
        incidentId: incidentIds[st.incident]!,
        shelterId: st.shelter ? shelterIds[st.shelter]! : null,
        role: st.role,
        createdAt: now,
      },
    });
    membershipIds[key] = id;
  }

  for (const [key, p] of Object.entries(ASSISTED) as [AssistedKey, (typeof ASSISTED)[AssistedKey]][]) {
    const incident = SHELTERS[p.shelter].incident;
    const personId = fixtureId(`person:assisted:${key}`);
    if (retired.has(personId)) continue;
    await prisma.person.upsert({
      where: { id: personId },
      update: {},
      create: {
        id: personId,
        incidentId: incidentIds[incident]!,
        alias: p.alias,
        requestMode: p.mode,
        restrictedReferral: p.restricted,
        encryptedMatchingClue: p.clue ? opts.crypto.encrypt(p.clue, 'person.matchingClue', personId) : null,
        createdAt: now,
      },
    });
    const credentialId = fixtureId(`assistance-credential:${key}`);
    await prisma.assistanceCredential.upsert({
      where: { id: credentialId },
      update: {},
      create: {
        id: credentialId,
        personId,
        digest: opts.crypto.digest('assistance', normalizeSecret(demoSecret(opts.seedSecret, `assist:${key}`))),
        issuedAt: now,
      },
    });
    const caseId = fixtureId(`case:${key}`);
    await prisma.assistanceCase.upsert({
      where: { id: caseId },
      update: {},
      create: {
        id: caseId,
        personId,
        incidentId: incidentIds[incident]!,
        shelterId: shelterIds[p.shelter]!,
        reference: demoCaseReference(opts.seedSecret, key),
        createdAt: now,
        lastActivityAt: now,
      },
    });
    const assignee = STAFF[p.assignee];
    const assignmentId = fixtureId(`assignment:${key}:${p.assignee}`);
    await prisma.caseAssignment.upsert({
      where: { id: assignmentId },
      update: {},
      create: {
        id: assignmentId,
        caseId,
        incidentId: incidentIds[incident]!,
        membershipId: membershipIds[p.assignee]!,
        staffAccountId: accountIds[assignee.username]!,
        purposes: ['INTAKE', 'ASSIST'],
        startsAt: now,
        assignedByAccountId: accountIds[assignee.username]!,
      },
    });
  }

  // Historical check-ins (phase 02). Leo: an older area report and a recent self-reported shelter report.
  const checkIns: {
    label: string;
    personId: string;
    shelter: keyof typeof SHELTERS | null;
    area: string;
    hoursAgo: number;
    author: string;
    caseLabel?: AssistedKey;
  }[] = [
    { label: 'leo-downtown', personId: fixtureId('person:leo'), shelter: null, area: 'Downtown', hoursAgo: 30, author: 'leo' },
    { label: 'leo-shelter-b', personId: fixtureId('person:leo'), shelter: 'B', area: SHELTERS.B.area, hoursAgo: 2, author: 'leo' },
    { label: 'sam-shelter-a', personId: fixtureId('person:assisted:sam'), shelter: 'A', area: SHELTERS.A.area, hoursAgo: 3, author: 'worker.a', caseLabel: 'sam' },
    { label: 'ana-shelter-b', personId: fixtureId('person:assisted:ana'), shelter: 'B', area: SHELTERS.B.area, hoursAgo: 5, author: 'worker.b', caseLabel: 'ana' },
  ];
  for (const c of checkIns) {
    if (retired.has(c.personId)) continue;
    const id = fixtureId(`checkin:${c.label}`);
    const observedAt = new Date(now.getTime() - c.hoursAgo * 3600_000);
    await prisma.checkIn.upsert({
      where: { id },
      update: {},
      create: {
        id,
        personId: c.personId,
        incidentId: incidentIds[INCIDENT_1]!,
        shelterId: c.shelter ? shelterIds[c.shelter]! : null,
        areaId: areaIds[`${INCIDENT_1}:${c.area}`]!,
        observedAt,
        receivedAt: observedAt,
        authorAccountId: accountIds[c.author]!,
        source: c.caseLabel ? 'STAFF_RECORDED' : 'SELF_REPORT',
        createdViaCaseId: c.caseLabel ? fixtureId(`case:${c.caseLabel}`) : null,
      },
    });
  }

  await prisma.systemFlag.upsert({
    where: { key: FIXTURES_SEEDED_FLAG },
    update: { value: 'true', updatedAt: now },
    create: { key: FIXTURES_SEEDED_FLAG, value: 'true', updatedAt: now },
  });
  return {
    accounts: await prisma.account.count(),
    memberships: await prisma.staffMembership.count(),
    cases: await prisma.assistanceCase.count(),
  };
}
