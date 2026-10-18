import { Prisma } from '@prisma/client';
import type { LoginInput, RecoverInput, RegisterInput, SessionDto } from '@rf/contracts';
import type { Deps } from '../deps.js';
import { dummyVerify, hashPassword, verifyPassword } from '../auth/password.js';
import { consume, enforce, peek } from '../auth/rateLimit.js';
import { createSession, csrfTokenFor, revokeAllSessions, revokeSession, sessionKindFor, type Actor } from '../auth/session.js';
import { AppError, conflict, rateLimited } from '../lib/errors.js';
import { HOUR, MINUTE } from '../lib/clock.js';
import { generateSecret, isWellFormedSecret, normalizeSecret } from '../lib/secrets.js';
import { audit } from './audit.js';
import { activeIncidentId } from './incident.js';

const invalidCredentials = () => new AppError(401, 'UNAUTHENTICATED', 'Username or password is incorrect.');
const invalidRecovery = () => new AppError(401, 'UNAUTHENTICATED', 'Those recovery details were not accepted.');

export function normalizeUsername(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase();
}

async function issueRecoverySecret(deps: Deps, tx: Prisma.TransactionClient, accountId: string): Promise<string> {
  const now = deps.clock.now();
  await tx.recoveryCredential.updateMany({
    where: { accountId, purpose: 'ACCOUNT_RECOVERY', usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  const secret = generateSecret();
  await tx.recoveryCredential.create({
    data: { accountId, purpose: 'ACCOUNT_RECOVERY', digest: deps.crypto.digest('recovery', normalizeSecret(secret)), createdAt: now },
  });
  return secret;
}

export async function register(deps: Deps, input: RegisterInput, ip: string) {
  await enforce(deps, `register-ip:${ip}`, deps.config.limits.registerIp, HOUR);
  const username = normalizeUsername(input.username);
  const passwordHash = await hashPassword(input.password);
  const incidentId = await activeIncidentId(deps);
  const now = deps.clock.now();
  try {
    return await deps.prisma.$transaction(async (tx) => {
      const account = await tx.account.create({ data: { normalizedUsername: username, passwordHash, createdAt: now } });
      await tx.person.create({ data: { accountId: account.id, incidentId, alias: input.alias, createdAt: now } });
      const recoverySecret = await issueRecoverySecret(deps, tx, account.id);
      const { token, sessionId } = await createSession(deps, tx, account, 'INDIVIDUAL');
      await audit(tx, { actorAccountId: account.id, action: 'account.register', objectType: 'Account', objectId: account.id, result: 'SUCCEEDED', at: now });
      return { token, sessionId, recoverySecret };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw conflict('That username is not available. Choose another one.');
    }
    throw e;
  }
}

export async function login(deps: Deps, input: LoginInput, ip: string, previousSessionId?: string) {
  const window = 15 * MINUTE;
  const ipBucket = await consume(deps, `login-ip:${ip}`, window);
  if (ipBucket.count > deps.config.limits.loginIp) throw rateLimited(ipBucket.retryAfterSeconds);
  const username = normalizeUsername(input.username);
  const userScope = `login-user:${username}`;
  const failures = await peek(deps, userScope, window);
  if (failures.count >= deps.config.limits.loginUser) throw rateLimited(failures.retryAfterSeconds);

  const account = await deps.prisma.account.findUnique({ where: { normalizedUsername: username } });
  const ok = account ? await verifyPassword(account.passwordHash, input.password) : await dummyVerify(input.password);
  const now = deps.clock.now();
  if (!account || !ok || account.state !== 'ACTIVE') {
    await consume(deps, userScope, window);
    await audit(deps.prisma, { actorAccountId: null, action: 'auth.login', objectType: 'Account', result: 'FAILED', at: now });
    throw invalidCredentials();
  }
  const kind = await sessionKindFor(deps.prisma, account.id);
  return deps.prisma.$transaction(async (tx) => {
    // Rotate: a new login never reuses a previous session identifier.
    if (previousSessionId) await revokeSession(deps, tx, previousSessionId);
    const created = await createSession(deps, tx, account, kind);
    await audit(tx, { actorAccountId: account.id, action: 'auth.login', objectType: 'Session', objectId: created.sessionId, result: 'SUCCEEDED', at: now });
    return created;
  });
}

export async function recover(deps: Deps, input: RecoverInput, ip: string) {
  const username = normalizeUsername(input.username);
  await enforce(deps, `recover-user:${username}`, 5, 15 * MINUTE);
  await enforce(deps, `recover-ip:${ip}`, deps.config.limits.loginIp, 15 * MINUTE);
  const account = await deps.prisma.account.findUnique({ where: { normalizedUsername: username } });
  const now = deps.clock.now();
  const fail = async () => {
    await audit(deps.prisma, { actorAccountId: null, action: 'auth.recover', objectType: 'Account', result: 'FAILED', at: now });
    return invalidRecovery();
  };
  if (!account || account.state !== 'ACTIVE' || !isWellFormedSecret(input.recoverySecret)) {
    await dummyVerify(input.newPassword);
    throw await fail();
  }
  const digest = deps.crypto.digest('recovery', normalizeSecret(input.recoverySecret));
  const newHash = await hashPassword(input.newPassword);
  const result = await deps.prisma.$transaction(async (tx) => {
    // Atomic single-use consumption: only one concurrent recovery can flip usedAt.
    const consumed = await tx.recoveryCredential.updateMany({
      where: { digest, accountId: account.id, purpose: 'ACCOUNT_RECOVERY', usedAt: null, revokedAt: null },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) return null;
    const updated = await tx.account.update({
      where: { id: account.id },
      data: { passwordHash: newHash, credentialVersion: { increment: 1 } },
    });
    await revokeAllSessions(deps, tx, account.id);
    const recoverySecret = await issueRecoverySecret(deps, tx, account.id);
    const kind = await sessionKindFor(tx, account.id);
    const created = await createSession(deps, tx, updated, kind);
    await audit(tx, { actorAccountId: account.id, action: 'auth.recover', objectType: 'Account', objectId: account.id, result: 'SUCCEEDED', at: now });
    return { ...created, recoverySecret };
  });
  if (!result) throw await fail();
  return result;
}

export async function rotateAccountRecovery(deps: Deps, actor: Actor, password: string): Promise<string> {
  await requirePassword(deps, actor.accountId, password);
  return deps.prisma.$transaction(async (tx) => {
    const secret = await issueRecoverySecret(deps, tx, actor.accountId);
    await audit(tx, { actorAccountId: actor.accountId, action: 'auth.recovery.rotate', objectType: 'Account', objectId: actor.accountId, result: 'SUCCEEDED', at: deps.clock.now() });
    return secret;
  });
}

export async function requirePassword(deps: Deps, accountId: string, password: string): Promise<void> {
  const scope = `reauth-fail:${accountId}`;
  const failures = await peek(deps, scope, 15 * MINUTE);
  if (failures.count >= deps.config.limits.loginUser) throw rateLimited(failures.retryAfterSeconds);
  const account = await deps.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  if (!(await verifyPassword(account.passwordHash, password))) {
    await consume(deps, scope, 15 * MINUTE);
    // 403: the session stays valid; only this re-authentication failed.
    throw new AppError(403, 'REAUTH_FAILED', 'That password is not correct.');
  }
}

export async function buildSessionDto(deps: Deps, actor: Actor): Promise<SessionDto> {
  const account = await deps.prisma.account.findUniqueOrThrow({
    where: { id: actor.accountId },
    select: {
      normalizedUsername: true,
      person: { select: { id: true, alias: true, deletedAt: true } },
      staffMfa: { select: { enrolledAt: true } },
      memberships: { where: { state: 'ACTIVE' }, select: { role: true, shelterId: true } },
    },
  });
  let staff: SessionDto['staff'] = null;
  if (account.memberships.length > 0) {
    const shelterIds = account.memberships.map((m) => m.shelterId).filter((x): x is string => !!x);
    const shelters = await deps.prisma.shelter.findMany({ where: { id: { in: shelterIds } }, select: { id: true, name: true } });
    staff = {
      memberships: account.memberships.map((m) => ({
        role: m.role,
        shelterName: shelters.find((s) => s.id === m.shelterId)?.name ?? null,
      })),
      mfaEnrolled: !!account.staffMfa?.enrolledAt,
      mfaVerified: actor.mfaVerified,
    };
  }
  const person = account.person && !account.person.deletedAt ? { id: account.person.id, alias: account.person.alias } : null;
  return {
    account: { username: account.normalizedUsername },
    person,
    staff,
    csrfToken: csrfTokenFor(deps, actor.sessionId),
    idleTimeoutSeconds: actor.idleTimeoutSeconds,
    expiresAt: actor.expiresAt.toISOString(),
  };
}
