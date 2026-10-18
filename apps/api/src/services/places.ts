import type { ShelterDto } from '@rf/contracts';
import type { Deps } from '../deps.js';
import { activeIncidentId } from './incident.js';

/** Public facility metadata only: no residents, counts or staff. */
export async function listPublicShelters(deps: Deps): Promise<ShelterDto[]> {
  const incidentId = await activeIncidentId(deps);
  const shelters = await deps.prisma.shelter.findMany({
    where: { incidentId, isPublic: true, state: 'OPEN' },
    include: { area: { select: { id: true, label: true } } },
    orderBy: { name: 'asc' },
  });
  return shelters.map((s) => ({ id: s.id, name: s.name, publicAddress: s.publicAddress, area: { id: s.area.id, label: s.area.label } }));
}

export async function listAreas(deps: Deps): Promise<{ id: string; label: string }[]> {
  const incidentId = await activeIncidentId(deps);
  const areas = await deps.prisma.area.findMany({ where: { incidentId }, orderBy: { label: 'asc' } });
  return areas.map((a) => ({ id: a.id, label: a.label }));
}

export interface PlaceMaps {
  shelters: Map<string, { name: string; publicAddress: string; areaId: string }>;
  areas: Map<string, string>;
}

/** Small lookup tables used by serializers; contains only public place data. */
export async function placeMaps(deps: Pick<Deps, 'prisma'>): Promise<PlaceMaps> {
  const [shelters, areas] = await Promise.all([deps.prisma.shelter.findMany(), deps.prisma.area.findMany()]);
  return {
    shelters: new Map(shelters.map((s) => [s.id, { name: s.name, publicAddress: s.publicAddress, areaId: s.areaId }])),
    areas: new Map(areas.map((a) => [a.id, a.label])),
  };
}
