import express, { Router } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from './deps.js';
import { accessLog, apiNotFound, errorHandler, noStore, requestId } from './http/middleware.js';
import { healthRoutes } from './routes/health.js';
import { mountApiV1 } from './routes/index.js';

export function createApp(deps: Deps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.trustProxy);
  app.use(requestId);
  app.use(accessLog(deps.logger));
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          ...(deps.config.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      strictTransportSecurity: deps.config.cookieSecure ? { maxAge: 15552000, includeSubDomains: false } : false,
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    next();
  });

  const api = Router();
  api.use(noStore);
  api.use('/health', healthRoutes(deps));
  api.use('/v1', mountApiV1(deps));
  api.use(apiNotFound);
  app.use('/api', api);

  const webDist = deps.config.webDistDir ?? path.resolve(process.cwd(), 'apps/web/dist');
  if (existsSync(path.join(webDist, 'index.html'))) {
    // Static, public assets only. API responses are never compressed (they can mix secrets such as
    // the CSRF token with user-supplied text, the precondition for BREACH-style attacks).
    app.use(compression());
    app.use(
      '/assets',
      express.static(path.join(webDist, 'assets'), { immutable: true, maxAge: '365d', index: false, fallthrough: false }),
    );
    app.use(express.static(webDist, { index: false, maxAge: 0 }));
    // Client-side routes: every other GET receives the app shell.
    app.get('/{*splat}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }
  app.use(errorHandler(deps.logger));
  return app;
}
