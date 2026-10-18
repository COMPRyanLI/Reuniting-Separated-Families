import { Router } from 'express';
import type { Deps } from '../deps.js';
import { requireActor } from '../auth/session.js';
import { isUuid, param } from '../http/validate.js';
import { notFound } from '../lib/errors.js';
import { listAccountNotifications, markAccountNotificationRead } from '../services/notifications.js';

/** Own generic notifications. Reading content always requires a fresh authorized request. */
export function notificationRoutes(deps: Deps): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    res.json(await listAccountNotifications(deps, requireActor(req).accountId));
  });
  r.post('/:id/read', async (req, res) => {
    const actor = requireActor(req);
    const id = param(req, 'id');
    if (!isUuid(id)) throw notFound();
    await markAccountNotificationRead(deps, actor.accountId, id);
    res.json({ status: 'read' });
  });
  return r;
}
