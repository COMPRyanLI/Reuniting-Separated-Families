/**
 * Operator administration used by the guarded CLI (scripts/staff-admin.ts) and tests.
 * There is intentionally no web endpoint for provisioning or role changes.
 */
import type { StaffRole } from '@prisma/client';
import type { Deps } from '../deps.js';
import { revokeAllSessions } from '../auth/session.js';
import { audit } from './audit.js';
import { normalizeUsername } from './accounts.js';

type AdminDeps = Pick<Deps, 'prisma' | 'clock'>;

async function accountByUsername(deps: AdminDeps, username: string) {
  const account = await deps.prisma.account.findUnique({ where: { normalizedUsername: normalizeUsername(username) } });
  if (!account) throw new Error('No such account.');
  return account;
}

export async function provisionStaff(
  deps: AdminDeps,
  input: { username: string; incidentSlug: string; shelterName: string | null; role: StaffRole },
) {
  const account = await accountByUsername(deps, input.username);
  const incident = await deps.prisma.incident.findUniqueOrThrow({ where: { slug: input.incidentSlug } });
  let shelterId: string | null = null;
  if (input.role !== 'OPERATOR') {
    if (!input.shelterName) throw new Error('Workers and coordinators need a shelter.');
    const shelter = await deps.prisma.shelter.findUniqueOrThrow({
      where: { incidentId_name: { incidentId: incident.id, name: input.shelterName } },
    });
    shelterId = shelter.id;
  }
  const now = deps.clock.now();
  return deps.prisma.$transaction(async (tx) => {
    const m = await tx.staffMembership.create({
      data: { accountId: account.id, incidentId: incident.id, shelterId, role: input.role, createdAt: now },
    });
    // Privilege change: existing sessions must re-authenticate (and complete MFA).
    await revokeAllSessions(deps, tx, account.id);
    await audit(tx, { actorAccountId: null, action: 'staff.provision', objectType: 'StaffMembership', objectId: m.id, authorityType: 'OPERATOR_CLI', result: 'SUCCEEDED', at: now });
    return m;
  });
}

export async function suspendMembership(deps: AdminDeps, username: string) {
  const account = await accountByUsername(deps, username);
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    await tx.staffMembership.updateMany({ where: { accountId: account.id, state: 'ACTIVE' }, data: { state: 'SUSPENDED', suspendedAt: now } });
    await revokeAllSessions(deps, tx, account.id);
    await audit(tx, { actorAccountId: null, action: 'staff.suspend', objectType: 'Account', objectId: account.id, authorityType: 'OPERATOR_CLI', result: 'SUCCEEDED', at: now });
  });
}

export async function suspendAccount(deps: AdminDeps, username: string) {
  const account = await accountByUsername(deps, username);
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: account.id }, data: { state: 'SUSPENDED' } });
    await revokeAllSessions(deps, tx, account.id);
    await audit(tx, { actorAccountId: null, action: 'account.suspend', objectType: 'Account', objectId: account.id, authorityType: 'OPERATOR_CLI', result: 'SUCCEEDED', at: now });
  });
}

export async function reinstateAccount(deps: AdminDeps, username: string) {
  const account = await accountByUsername(deps, username);
  await deps.prisma.account.update({ where: { id: account.id }, data: { state: 'ACTIVE' } });
}

export async function resetStaffMfa(deps: AdminDeps, username: string) {
  const account = await accountByUsername(deps, username);
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    await tx.staffMfa.deleteMany({ where: { accountId: account.id } });
    await tx.recoveryCredential.updateMany({ where: { accountId: account.id, purpose: 'STAFF_MFA_RECOVERY', usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await revokeAllSessions(deps, tx, account.id);
    await audit(tx, { actorAccountId: null, action: 'staff.mfa.reset', objectType: 'Account', objectId: account.id, authorityType: 'OPERATOR_CLI', result: 'SUCCEEDED', at: now });
  });
}
