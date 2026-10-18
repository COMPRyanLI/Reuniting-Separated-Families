import type { NextFunction, Request, Response } from 'express';
import type { Deps } from '../deps.js';
import { AppError } from '../lib/errors.js';
import { audit } from './audit.js';
import { applyDeletion, purgePerson } from './deletion.js';

/**
 * Restore-safe ledger: identifiers and timestamps only, never content. It must be exported
 * from the newest available source (live database or its off-box copy) before a restore,
 * then replayed onto the restored database before it serves traffic.
 */
export interface Ledger {
  version: 1;
  exportedAt: string;
  deletions: { personRef: string; accountRef: string | null; deletedAt: string }[];
  grantRevocations: { grantId: string; revokedAt: string }[];
  suspendedAccounts: string[];
  suspendedMemberships: string[];
  revokedContactCodes: string[];
  revokedAssistanceCredentials: string[];
}

const FLAG = 'restore_replay_required';

export async function exportLedger(deps: Pick<Deps, 'prisma' | 'clock'>): Promise<Ledger> {
  const [tombs, grants, accounts, memberships, codes, creds] = await Promise.all([
    deps.prisma.deletionTombstone.findMany({ orderBy: { deletedAt: 'asc' } }),
    deps.prisma.sharingGrant.findMany({ where: { revokedAt: { not: null } }, select: { id: true, revokedAt: true } }),
    deps.prisma.account.findMany({ where: { state: { in: ['SUSPENDED', 'DELETED'] } }, select: { id: true } }),
    deps.prisma.staffMembership.findMany({ where: { state: 'SUSPENDED' }, select: { id: true } }),
    deps.prisma.contactCode.findMany({ where: { revokedAt: { not: null } }, select: { id: true } }),
    deps.prisma.assistanceCredential.findMany({ where: { revokedAt: { not: null } }, select: { id: true } }),
  ]);
  return {
    version: 1,
    exportedAt: deps.clock.now().toISOString(),
    deletions: tombs.map((t) => ({ personRef: t.personRef, accountRef: t.accountRef, deletedAt: t.deletedAt.toISOString() })),
    grantRevocations: grants.map((g) => ({ grantId: g.id, revokedAt: g.revokedAt!.toISOString() })),
    suspendedAccounts: accounts.map((a) => a.id),
    suspendedMemberships: memberships.map((m) => m.id),
    revokedContactCodes: codes.map((c) => c.id),
    revokedAssistanceCredentials: creds.map((c) => c.id),
  };
}

export async function markRestoreStarted(deps: Pick<Deps, 'prisma' | 'clock'>): Promise<void> {
  const now = deps.clock.now();
  await deps.prisma.systemFlag.upsert({ where: { key: FLAG }, update: { value: 'true', updatedAt: now }, create: { key: FLAG, value: 'true', updatedAt: now } });
}

/** Re-applies deletions and revocations, invalidates every restored session, then opens the gate. */
export async function replayLedger(deps: Deps, ledger: Ledger) {
  if (ledger.version !== 1) throw new Error('Unsupported ledger version');
  const now = deps.clock.now();
  let deletionsApplied = 0;
  for (const d of ledger.deletions) {
    await deps.prisma.$transaction(async (tx) => {
      const person = await tx.person.findUnique({ where: { id: d.personRef } });
      if (!person) return;
      await applyDeletion(deps, tx, person.id, d.accountRef, new Date(d.deletedAt));
      await purgePerson(deps, tx, person.id, d.accountRef, now);
      const existing = await tx.deletionTombstone.findFirst({ where: { personRef: person.id } });
      if (existing) await tx.deletionTombstone.update({ where: { id: existing.id }, data: { purgedAt: now } });
      else await tx.deletionTombstone.create({ data: { personRef: person.id, accountRef: d.accountRef, deletedAt: new Date(d.deletedAt), purgeAfter: new Date(d.deletedAt), purgedAt: now, reason: 'LEDGER_REPLAY' } });
    });
    deletionsApplied++;
  }
  const revoked = await deps.prisma.sharingGrant.updateMany({
    where: { id: { in: ledger.grantRevocations.map((g) => g.grantId) }, revokedAt: null },
    data: { revokedAt: now, revokedReason: 'LEDGER_REPLAY' },
  });
  await deps.prisma.account.updateMany({ where: { id: { in: ledger.suspendedAccounts }, state: 'ACTIVE' }, data: { state: 'SUSPENDED' } });
  await deps.prisma.staffMembership.updateMany({ where: { id: { in: ledger.suspendedMemberships }, state: 'ACTIVE' }, data: { state: 'SUSPENDED', suspendedAt: now } });
  await deps.prisma.contactCode.updateMany({ where: { id: { in: ledger.revokedContactCodes }, revokedAt: null }, data: { revokedAt: now } });
  await deps.prisma.assistanceCredential.updateMany({ where: { id: { in: ledger.revokedAssistanceCredentials }, revokedAt: null }, data: { revokedAt: now } });
  // Sessions in a backup may have been revoked after it was taken: require everyone to sign in again.
  await deps.prisma.session.updateMany({ where: { revokedAt: null }, data: { revokedAt: now } });
  await deps.prisma.assistanceSession.updateMany({ where: { revokedAt: null }, data: { revokedAt: now } });
  await audit(deps.prisma, { actorAccountId: null, action: 'restore.replay', objectType: 'System', authorityType: 'OPERATOR_CLI', result: 'SUCCEEDED', at: now });
  await deps.prisma.systemFlag.update({ where: { key: FLAG }, data: { value: 'false', updatedAt: now } });
  return { deletionsApplied, grantRevocationsApplied: revoked.count };
}

/** While a restore replay is pending, the API serves nothing but health checks. */
export function restoreGate(deps: Deps) {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      const flag = await deps.prisma.systemFlag.findUnique({ where: { key: FLAG } });
      if (flag?.value === 'true') return next(new AppError(503, 'SERVICE_UNAVAILABLE', 'The service is being restored. Please try again later.'));
    } catch {
      // Table missing (pre-lifecycle schema) means no restore gate exists yet.
    }
    next();
  };
}
