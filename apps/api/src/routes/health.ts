import { Router } from 'express';
import type { Deps } from '../deps.js';

export function healthRoutes(deps: Deps): Router {
  const r = Router();
  // Liveness: the process answers. Deliberately says nothing about the database.
  r.get('/live', (_req, res) => {
    res.json({ status: 'live' });
  });
  // Readiness: dependencies reachable and no pending restore replay.
  r.get('/ready', async (_req, res) => {
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
    } catch {
      res.status(503).json({ status: 'not_ready', checks: { database: 'unavailable' } });
      return;
    }
    if ((await readRestoreGate(deps)) === 'replay_required') {
      res.status(503).json({ status: 'not_ready', checks: { database: 'ok', restoreReplay: 'required' } });
      return;
    }
    res.json({ status: 'ready', checks: { database: 'ok' } });
  });
  return r;
}

export async function readRestoreGate(deps: Pick<Deps, 'prisma'>): Promise<'ok' | 'replay_required'> {
  try {
    const rows = await deps.prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "SystemFlag" WHERE "key" = 'restore_replay_required'`;
    return rows[0]?.value === 'true' ? 'replay_required' : 'ok';
  } catch {
    // Table introduced in a later migration; absence means no restore is pending.
    return 'ok';
  }
}
