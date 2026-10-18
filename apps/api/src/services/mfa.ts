import type { Deps } from '../deps.js';
import { consume, peek } from '../auth/rateLimit.js';
import { createSession, revokeSession, type Actor } from '../auth/session.js';
import { newTotpSecret, verifyTotp } from '../auth/mfa.js';
import { AppError, conflict, forbidden, rateLimited } from '../lib/errors.js';
import { MINUTE } from '../lib/clock.js';
import { generateSecret, isWellFormedSecret, normalizeSecret } from '../lib/secrets.js';
import { audit } from './audit.js';
import { requirePassword } from './accounts.js';

// 403, not 401: the session is still valid, so the client must not treat a mistyped code as "signed out".
const rejected = () => new AppError(403, 'MFA_REJECTED', 'That code was not accepted. Wait for a new code and try again.');

async function requireStaffAccount(deps: Deps, actor: Actor) {
  const count = await deps.prisma.staffMembership.count({ where: { accountId: actor.accountId, state: 'ACTIVE' } });
  if (count === 0) throw forbidden('Two-step verification is only used for staff accounts.');
}

export async function enrollMfa(deps: Deps, actor: Actor, password: string) {
  await requireStaffAccount(deps, actor);
  await requirePassword(deps, actor.accountId, password);
  const existing = await deps.prisma.staffMfa.findUnique({ where: { accountId: actor.accountId } });
  if (existing?.enrolledAt) throw conflict('Two-step verification is already set up for this account.');
  const secret = newTotpSecret();
  const encrypted = deps.crypto.encrypt(secret.base32, 'staff.totp', actor.accountId);
  const now = deps.clock.now();
  await deps.prisma.staffMfa.upsert({
    where: { accountId: actor.accountId },
    update: { encryptedTotpSecret: encrypted, createdAt: now, enrolledAt: null, lastAcceptedStep: null },
    create: { accountId: actor.accountId, encryptedTotpSecret: encrypted, createdAt: now },
  });
  const account = await deps.prisma.account.findUniqueOrThrow({ where: { id: actor.accountId } });
  await audit(deps.prisma, { actorAccountId: actor.accountId, action: 'mfa.enroll.start', objectType: 'Account', objectId: actor.accountId, result: 'SUCCEEDED', at: now });
  return { secret: secret.base32, otpauthUri: secret.uri(account.normalizedUsername) };
}

async function issueMfaRecoveryCodes(deps: Deps, tx: Parameters<Parameters<Deps['prisma']['$transaction']>[0]>[0], accountId: string) {
  const now = deps.clock.now();
  await tx.recoveryCredential.updateMany({
    where: { accountId, purpose: 'STAFF_MFA_RECOVERY', usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const code = generateSecret();
    codes.push(code);
    await tx.recoveryCredential.create({
      data: { accountId, purpose: 'STAFF_MFA_RECOVERY', digest: deps.crypto.digest('mfa-recovery', normalizeSecret(code)), createdAt: now },
    });
  }
  return codes;
}

export async function verifyMfa(deps: Deps, actor: Actor, input: { code?: string; recoveryCode?: string }) {
  await requireStaffAccount(deps, actor);
  // Failed attempts are limited per account (5 per 15 minutes); successful sign-ins are not.
  const failScope = `mfa-fail:${actor.accountId}`;
  const failures = await peek(deps, failScope, 15 * MINUTE);
  if (failures.count >= 5) throw rateLimited(failures.retryAfterSeconds);
  const now = deps.clock.now();
  const mfa = await deps.prisma.staffMfa.findUnique({ where: { accountId: actor.accountId } });
  if (!mfa) throw forbidden('Set up two-step verification first.');

  try {
    return await verifyInTransaction(deps, actor, input, mfa, now);
  } catch (e) {
    if (e instanceof AppError && e.code === 'MFA_REJECTED') {
      await consume(deps, failScope, 15 * MINUTE);
      await audit(deps.prisma, { actorAccountId: actor.accountId, action: 'mfa.verify', objectType: 'Account', objectId: actor.accountId, result: 'FAILED', at: now });
    }
    throw e;
  }
}

async function verifyInTransaction(
  deps: Deps,
  actor: Actor,
  input: { code?: string; recoveryCode?: string },
  mfa: { encryptedTotpSecret: string; enrolledAt: Date | null },
  now: Date,
) {
  return deps.prisma.$transaction(async (tx) => {
    let recoveryCodes: string[] | undefined;
    if (input.code) {
      const secret = deps.crypto.decrypt(mfa.encryptedTotpSecret, 'staff.totp', actor.accountId);
      const step = verifyTotp(secret, input.code, now);
      if (step === null) throw rejected();
      // Conditional update rejects replays (same or older time step), including concurrent ones.
      const accepted = await tx.staffMfa.updateMany({
        where: { accountId: actor.accountId, OR: [{ lastAcceptedStep: null }, { lastAcceptedStep: { lt: step } }] },
        data: { lastAcceptedStep: step, ...(mfa.enrolledAt ? {} : { enrolledAt: now }) },
      });
      if (accepted.count !== 1) throw rejected();
      if (!mfa.enrolledAt) recoveryCodes = await issueMfaRecoveryCodes(deps, tx, actor.accountId);
    } else if (input.recoveryCode) {
      if (!mfa.enrolledAt || !isWellFormedSecret(input.recoveryCode)) throw rejected();
      const used = await tx.recoveryCredential.updateMany({
        where: {
          accountId: actor.accountId,
          purpose: 'STAFF_MFA_RECOVERY',
          digest: deps.crypto.digest('mfa-recovery', normalizeSecret(input.recoveryCode)),
          usedAt: null,
          revokedAt: null,
        },
        data: { usedAt: now },
      });
      if (used.count !== 1) throw rejected();
    } else {
      throw rejected();
    }
    // Privilege change: rotate the session identifier.
    const account = await tx.account.findUniqueOrThrow({ where: { id: actor.accountId } });
    await revokeSession(deps, tx, actor.sessionId);
    const created = await createSession(deps, tx, account, 'STAFF', now);
    await audit(tx, { actorAccountId: actor.accountId, action: 'mfa.verify', objectType: 'Session', objectId: created.sessionId, result: 'SUCCEEDED', at: now });
    return { ...created, recoveryCodes };
  });
}

export async function rotateMfaRecoveryCodes(deps: Deps, actor: Actor, password: string) {
  await requireStaffAccount(deps, actor);
  await requirePassword(deps, actor.accountId, password);
  const mfa = await deps.prisma.staffMfa.findUnique({ where: { accountId: actor.accountId } });
  if (!mfa?.enrolledAt || !actor.mfaVerified) throw forbidden('Complete two-step verification first.');
  return deps.prisma.$transaction((tx) => issueMfaRecoveryCodes(deps, tx, actor.accountId));
}
