import { Router } from 'express';
import { loginSchema, mfaVerifySchema, reauthSchema, recoverSchema, registerSchema, rotateRecoverySchema } from '@rf/contracts';
import type { Deps } from '../deps.js';
import { parseBody } from '../http/validate.js';
import { clearSessionCookie, requireActor, revokeSession, setSessionCookie, type Actor } from '../auth/session.js';
import { buildSessionDto, login, recover, register, rotateAccountRecovery } from '../services/accounts.js';
import { enrollMfa, rotateMfaRecoveryCodes, verifyMfa } from '../services/mfa.js';
import { audit } from '../services/audit.js';

async function actorFor(deps: Deps, sessionId: string): Promise<Actor> {
  const s = await deps.prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { account: { select: { person: { select: { id: true, deletedAt: true } } } } },
  });
  const p = s.account.person;
  return {
    sessionId: s.id,
    accountId: s.accountId,
    kind: s.kind,
    mfaVerified: s.mfaVerifiedAt !== null,
    personId: p && !p.deletedAt ? p.id : null,
    expiresAt: s.expiresAt,
    idleTimeoutSeconds: s.idleTimeoutSeconds,
  };
}

export function authRoutes(deps: Deps): Router {
  const r = Router();

  r.post('/register', async (req, res) => {
    const input = parseBody(registerSchema, req);
    const result = await register(deps, input, req.ip ?? 'unknown');
    setSessionCookie(deps, res, result.token);
    const session = await buildSessionDto(deps, await actorFor(deps, result.sessionId));
    res.status(201).json({ recoverySecret: result.recoverySecret, session });
  });

  r.post('/login', async (req, res) => {
    const input = parseBody(loginSchema, req);
    const result = await login(deps, input, req.ip ?? 'unknown', req.actor?.sessionId);
    setSessionCookie(deps, res, result.token);
    const session = await buildSessionDto(deps, await actorFor(deps, result.sessionId));
    res.json({ session, csrfToken: session.csrfToken });
  });

  r.post('/logout', async (req, res) => {
    const actor = requireActor(req);
    await revokeSession(deps, deps.prisma, actor.sessionId);
    await audit(deps.prisma, { actorAccountId: actor.accountId, action: 'auth.logout', objectType: 'Session', objectId: actor.sessionId, result: 'SUCCEEDED', at: deps.clock.now() });
    clearSessionCookie(deps, res);
    res.status(204).end();
  });

  r.post('/recover', async (req, res) => {
    const input = parseBody(recoverSchema, req);
    const result = await recover(deps, input, req.ip ?? 'unknown');
    setSessionCookie(deps, res, result.token);
    const session = await buildSessionDto(deps, await actorFor(deps, result.sessionId));
    res.json({ recoverySecret: result.recoverySecret, session, csrfToken: session.csrfToken });
  });

  r.get('/session', async (req, res) => {
    const actor = requireActor(req);
    res.json(await buildSessionDto(deps, actor));
  });

  r.post('/recovery-codes', async (req, res) => {
    const actor = requireActor(req);
    const input = parseBody(rotateRecoverySchema, req);
    if (input.kind === 'ACCOUNT_RECOVERY') {
      res.json({ recoverySecret: await rotateAccountRecovery(deps, actor, input.password) });
    } else {
      res.json({ recoveryCodes: await rotateMfaRecoveryCodes(deps, actor, input.password) });
    }
  });

  r.post('/mfa/enroll', async (req, res) => {
    const actor = requireActor(req);
    const input = parseBody(reauthSchema, req);
    res.json(await enrollMfa(deps, actor, input.password));
  });

  r.post('/mfa/verify', async (req, res) => {
    const actor = requireActor(req);
    const input = parseBody(mfaVerifySchema, req);
    const result = await verifyMfa(deps, actor, input);
    setSessionCookie(deps, res, result.token);
    const session = await buildSessionDto(deps, await actorFor(deps, result.sessionId));
    res.json({ session, csrfToken: session.csrfToken, ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}) });
  });

  return r;
}
