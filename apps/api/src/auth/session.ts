import type { NextFunction, Request, Response } from 'express';
import type { Prisma, PrismaClient, SessionKind } from '@prisma/client';
import type { Deps } from '../deps.js';
import { randomToken } from '../lib/secrets.js';
import { unauthenticated } from '../lib/errors.js';

type Db = PrismaClient | Prisma.TransactionClient;

export const SESSION_POLICY: Record<SessionKind, { idleSeconds: number; absoluteMs: number }> = {
  INDIVIDUAL: { idleSeconds: 30 * 60, absoluteMs: 12 * 3600_000 },
  STAFF: { idleSeconds: 15 * 60, absoluteMs: 8 * 3600_000 },
};

export interface Actor {
  sessionId: string;
  accountId: string;
  kind: SessionKind;
  mfaVerified: boolean;
  personId: string | null;
  expiresAt: Date;
  idleTimeoutSeconds: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
  }
}

export async function sessionKindFor(db: Db, accountId: string): Promise<SessionKind> {
  const staff = await db.staffMembership.count({ where: { accountId, state: 'ACTIVE' } });
  return staff > 0 ? 'STAFF' : 'INDIVIDUAL';
}

export async function createSession(
  deps: Pick<Deps, 'clock' | 'crypto'>,
  db: Db,
  account: { id: string; credentialVersion: number },
  kind: SessionKind,
  mfaVerifiedAt: Date | null = null,
): Promise<{ token: string; sessionId: string }> {
  const now = deps.clock.now();
  const token = randomToken(32);
  const policy = SESSION_POLICY[kind];
  const s = await db.session.create({
    data: {
      accountId: account.id,
      tokenDigest: deps.crypto.digest('session', token),
      kind,
      credentialVersion: account.credentialVersion,
      createdAt: now,
      lastUserActivityAt: now,
      idleTimeoutSeconds: policy.idleSeconds,
      expiresAt: new Date(now.getTime() + policy.absoluteMs),
      mfaVerifiedAt,
    },
  });
  return { token, sessionId: s.id };
}

export function setSessionCookie(deps: Pick<Deps, 'config'>, res: Response, token: string): void {
  res.cookie(deps.config.sessionCookieName, token, {
    httpOnly: true,
    secure: deps.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
  });
}

export function clearSessionCookie(deps: Pick<Deps, 'config'>, res: Response): void {
  res.clearCookie(deps.config.sessionCookieName, {
    httpOnly: true,
    secure: deps.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
  });
}

export function readSessionToken(deps: Pick<Deps, 'config'>, req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === deps.config.sessionCookieName) {
      const value = part.slice(idx + 1).trim();
      return value.length > 0 && value.length <= 128 ? decodeURIComponent(value) : undefined;
    }
  }
  return undefined;
}

export function csrfTokenFor(deps: Pick<Deps, 'crypto'>, sessionId: string): string {
  return deps.crypto.digest('csrf', sessionId);
}

/**
 * Loads and validates the session on every API request. Background polling
 * (X-Background-Refresh: 1) is served but does not count as user activity, so it
 * cannot keep an abandoned shared-device session alive.
 */
export function loadSession(deps: Deps) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = readSessionToken(deps, req);
    if (!token) return next();
    const now = deps.clock.now();
    const session = await deps.prisma.session.findUnique({
      where: { tokenDigest: deps.crypto.digest('session', token) },
      include: { account: { select: { state: true, credentialVersion: true, person: { select: { id: true, deletedAt: true } } } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.lastUserActivityAt.getTime() + session.idleTimeoutSeconds * 1000 <= now.getTime() ||
      session.account.state !== 'ACTIVE' ||
      session.account.credentialVersion !== session.credentialVersion
    ) {
      return next();
    }
    if (req.get('X-Background-Refresh') !== '1') {
      await deps.prisma.session.update({ where: { id: session.id }, data: { lastUserActivityAt: now } });
    }
    const person = session.account.person;
    req.actor = {
      sessionId: session.id,
      accountId: session.accountId,
      kind: session.kind,
      mfaVerified: session.mfaVerifiedAt !== null,
      personId: person && !person.deletedAt ? person.id : null,
      expiresAt: session.expiresAt,
      idleTimeoutSeconds: session.idleTimeoutSeconds,
    };
    next();
  };
}

export function requireActor(req: Request): Actor {
  if (!req.actor) throw unauthenticated();
  return req.actor;
}

export async function revokeSession(deps: Pick<Deps, 'clock'>, db: Db, sessionId: string): Promise<void> {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: deps.clock.now() } });
}

export async function revokeAllSessions(deps: Pick<Deps, 'clock'>, db: Db, accountId: string): Promise<void> {
  await db.session.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: deps.clock.now() } });
}
