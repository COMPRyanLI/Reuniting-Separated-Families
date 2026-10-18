import { Router } from 'express';
import type { Deps } from '../deps.js';
import { listAreas, listPublicShelters } from '../services/places.js';

/** Public: facility metadata and canonical areas only. */
export function placeRoutes(deps: Deps): Router {
  const r = Router();
  r.get('/shelters', async (_req, res) => {
    res.json({ shelters: await listPublicShelters(deps) });
  });
  r.get('/areas', async (_req, res) => {
    res.json({ areas: await listAreas(deps) });
  });
  return r;
}
