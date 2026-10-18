import { Router, type Request } from 'express';
import { abuseReportSchema, leadUpdateSchema, requestCreateSchema, respondSchema } from '@rf/contracts';
import type { Deps } from '../deps.js';
import { requireActor } from '../auth/session.js';
import { idempotencyKey, isUuid, param, parseBody } from '../http/validate.js';
import { notFound } from '../lib/errors.js';
import { requireOwnPerson } from '../policy/person.js';
import type { SubjectAuthority } from '../services/people.js';
import {
  blockRequester,
  declineRequest,
  getRequestForParticipant,
  listIncoming,
  listOutgoing,
  respondToRequest,
  withdrawRequest,
} from '../services/requests.js';
import { createRoutedRequest, updateLead } from '../services/routing.js';
import { createAbuseReport, getResponseForRecipient, listSharedWithMe, revokeGrant } from '../services/sharing.js';

export function selfAuthority(req: Request): SubjectAuthority {
  const actor = requireActor(req);
  return { personId: requireOwnPerson(actor), actorAccountId: actor.accountId, authorityType: 'SELF' };
}

function idParam(req: Request, name = 'id'): string {
  const v = param(req, name);
  if (!isUuid(v)) throw notFound();
  return v;
}

export function requestRoutes(deps: Deps): Router {
  const r = Router();

  r.post('/', async (req, res) => {
    const auth = selfAuthority(req);
    const input = parseBody(requestCreateSchema, req);
    const result = await createRoutedRequest(deps, auth, input, idempotencyKey(req));
    // Identical envelope for every well-formed outcome; the owner's request ID only.
    res.status(202).json({ status: 'submitted', requestId: result.requestId });
  });

  r.get('/outgoing', async (req, res) => {
    res.json({ requests: await listOutgoing(deps, selfAuthority(req).personId) });
  });

  r.get('/incoming', async (req, res) => {
    res.json({ requests: await listIncoming(deps, selfAuthority(req).personId) });
  });

  r.get('/:id', async (req, res) => {
    const auth = selfAuthority(req);
    res.json(await getRequestForParticipant(deps, auth.personId, idParam(req)));
  });

  r.post('/:id/withdraw', async (req, res) => {
    const auth = selfAuthority(req);
    await withdrawRequest(deps, auth, idParam(req));
    res.json({ status: 'WITHDRAWN' });
  });

  r.post('/:id/respond', async (req, res) => {
    const auth = selfAuthority(req);
    const id = idParam(req);
    const input = parseBody(respondSchema, req);
    const result = await respondToRequest(deps, auth, id, input, idempotencyKey(req));
    res.status(result.replayed ? 200 : 201).json(result.body);
  });

  r.post('/:id/decline', async (req, res) => {
    const auth = selfAuthority(req);
    await declineRequest(deps, auth, idParam(req));
    res.json({ status: 'DECLINED' });
  });

  r.post('/:id/block', async (req, res) => {
    const auth = selfAuthority(req);
    await blockRequester(deps, auth, idParam(req));
    res.json({ status: 'BLOCKED' });
  });

  r.post('/:id/lead', async (req, res) => {
    const auth = selfAuthority(req);
    const id = idParam(req);
    await updateLead(deps, auth, id, parseBody(leadUpdateSchema, req));
    res.json({ status: 'updated' });
  });

  return r;
}

export function responseRoutes(deps: Deps): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    res.json({ responses: await listSharedWithMe(deps, selfAuthority(req).personId) });
  });
  r.get('/:id', async (req, res) => {
    const auth = selfAuthority(req);
    res.json(await getResponseForRecipient(deps, auth.personId, idParam(req)));
  });
  return r;
}

export function grantRoutes(deps: Deps): Router {
  const r = Router();
  r.post('/:id/revoke', async (req, res) => {
    const auth = selfAuthority(req);
    await revokeGrant(deps, auth, idParam(req));
    res.json({ status: 'REVOKED' });
  });
  return r;
}

export function abuseRoutes(deps: Deps): Router {
  const r = Router();
  r.post('/', async (req, res) => {
    const auth = selfAuthority(req);
    res.status(201).json(await createAbuseReport(deps, auth, parseBody(abuseReportSchema, req)));
  });
  return r;
}
