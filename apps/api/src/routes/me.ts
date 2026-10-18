import { Router } from 'express';
import { checkInCreateSchema, deleteSelfSchema, privacyUpdateSchema, profileUpdateSchema } from '@rf/contracts';
import type { Deps } from '../deps.js';
import { clearSessionCookie, requireActor } from '../auth/session.js';
import { requirePassword } from '../services/accounts.js';
import { deletePerson } from '../services/deletion.js';
import { idempotencyKey, isUuid, param, parseBody } from '../http/validate.js';
import { notFound } from '../lib/errors.js';
import { requireOwnPerson } from '../policy/person.js';
import { createCheckIn, departCheckIn, listOwnCheckIns, toOwnCheckInDto } from '../services/checkins.js';
import { idempotent } from '../services/idempotency.js';
import { getProfile, rotateContactCode, updateAlias, updatePrivacy, type SubjectAuthority } from '../services/people.js';
import { placeMaps } from '../services/places.js';
import { listGrants, revokeAllGrants } from '../services/sharing.js';

export function meRoutes(deps: Deps): Router {
  const r = Router();
  const self = (req: Parameters<typeof requireActor>[0]): SubjectAuthority => {
    const actor = requireActor(req);
    return { personId: requireOwnPerson(actor), actorAccountId: actor.accountId, authorityType: 'SELF' };
  };

  r.get('/', async (req, res) => {
    res.json(await getProfile(deps, self(req).personId));
  });

  r.patch('/', async (req, res) => {
    const auth = self(req);
    res.json(await updateAlias(deps, auth, parseBody(profileUpdateSchema, req)));
  });

  r.patch('/privacy', async (req, res) => {
    const auth = self(req);
    res.json(await updatePrivacy(deps, auth, parseBody(privacyUpdateSchema, req)));
  });

  r.post('/contact-code/rotate', async (req, res) => {
    const contactCode = await rotateContactCode(deps, self(req));
    res.status(201).json({ contactCode });
  });

  r.get('/check-ins', async (req, res) => {
    res.json({ checkIns: await listOwnCheckIns(deps, self(req).personId) });
  });

  r.post('/check-ins', async (req, res) => {
    const auth = self(req);
    const input = parseBody(checkInCreateSchema, req);
    const key = idempotencyKey(req);
    const result = await idempotent(
      deps,
      { actorAccountId: auth.actorAccountId, operation: 'checkin.create', subjectKey: auth.personId, key, payload: input },
      async (tx) => ({ outcomeType: 'CheckIn', outcomeId: (await createCheckIn(deps, tx, auth, input)).id }),
    );
    const row = await deps.prisma.checkIn.findFirst({ where: { id: result.outcomeId, personId: auth.personId } });
    if (!row) throw notFound();
    res.status(result.replayed ? 200 : 201).json({ checkIn: toOwnCheckInDto(row, await placeMaps(deps)) });
  });

  r.post('/check-ins/:id/depart', async (req, res) => {
    const auth = self(req);
    const id = param(req, 'id');
    if (!isUuid(id)) throw notFound();
    const row = await departCheckIn(deps, auth, id);
    const fresh = await deps.prisma.checkIn.findUniqueOrThrow({ where: { id: row.id } });
    res.json({ checkIn: toOwnCheckInDto(fresh, await placeMaps(deps)) });
  });

  /** Re-authenticated self deletion: access ends now; content is purged by the retention job. */
  r.delete('/', async (req, res) => {
    const auth = self(req);
    const input = parseBody(deleteSelfSchema, req);
    await requirePassword(deps, auth.actorAccountId, input.password);
    await deletePerson(deps, auth, 'SELF');
    clearSessionCookie(deps, res);
    res.status(204).end();
  });

  r.get('/grants', async (req, res) => {
    res.json({ grants: await listGrants(deps, self(req).personId) });
  });

  r.post('/grants/revoke-all', async (req, res) => {
    res.json({ revoked: await revokeAllGrants(deps, self(req)) });
  });

  return r;
}
