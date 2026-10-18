import type { NextFunction, Request, Response } from 'express';
import type { Deps } from '../deps.js';
import { AppError } from '../lib/errors.js';
import { csrfTokenFor } from './session.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Public credential endpoints are protected by the Origin check; there is no session token yet. */
const TOKEN_EXEMPT = new Set(['/auth/login', '/auth/register', '/auth/recover']);

const rejected = () => new AppError(403, 'CSRF_REJECTED', 'This request was blocked for your protection. Reload the page and try again.');

/**
 * State-changing requests must come from the configured origin, and cookie-authenticated
 * ones must also carry the per-session CSRF token. No credentialed CORS is enabled.
 */
export function csrfProtection(deps: Deps) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE.has(req.method)) return next();
    if (req.get('Origin') !== deps.config.appOrigin) return next(rejected());
    if (TOKEN_EXEMPT.has(req.path)) return next();
    if (req.actor) {
      const supplied = req.get('X-CSRF-Token') ?? '';
      if (!deps.crypto.digestEquals(supplied, csrfTokenFor(deps, req.actor.sessionId))) return next(rejected());
    }
    next();
  };
}
