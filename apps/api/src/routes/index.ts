import express, { Router } from 'express';
import type { Deps } from '../deps.js';
import { loadSession } from '../auth/session.js';
import { csrfProtection } from '../auth/csrf.js';
import { authRoutes } from './auth.js';
import { meRoutes } from './me.js';
import { placeRoutes } from './places.js';
import { staffRoutes } from './staff.js';
import { abuseRoutes, grantRoutes, requestRoutes, responseRoutes } from './requests.js';
import { notificationRoutes } from './notifications.js';
import { restoreGate } from '../services/restore.js';

export function mountApiV1(deps: Deps): Router {
  const v1 = Router();
  v1.use(restoreGate(deps));
  v1.use(express.json({ limit: '16kb', strict: true }));
  v1.use(loadSession(deps));
  v1.use(csrfProtection(deps));
  v1.use('/auth', authRoutes(deps));
  v1.use('/me', meRoutes(deps));
  v1.use('/staff', staffRoutes(deps));
  v1.use('/requests', requestRoutes(deps));
  v1.use('/responses', responseRoutes(deps));
  v1.use('/grants', grantRoutes(deps));
  v1.use('/abuse-reports', abuseRoutes(deps));
  v1.use('/notifications', notificationRoutes(deps));
  v1.use('/', placeRoutes(deps));
  return v1;
}
