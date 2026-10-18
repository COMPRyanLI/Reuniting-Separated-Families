import type { Deps } from '../deps.js';
import { AppError } from '../lib/errors.js';

const cache = new WeakMap<object, string>();

/** The single active incident this deployment serves (configured by slug). */
export async function activeIncidentId(deps: Pick<Deps, 'prisma' | 'config'>): Promise<string> {
  const cached = cache.get(deps.prisma);
  if (cached) return cached;
  const incident = await deps.prisma.incident.findUnique({ where: { slug: deps.config.incidentSlug } });
  if (!incident || incident.state !== 'ACTIVE') {
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'The service is not configured for an active incident.');
  }
  cache.set(deps.prisma, incident.id);
  return incident.id;
}
