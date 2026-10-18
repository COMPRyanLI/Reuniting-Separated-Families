import { useQuery } from '@tanstack/react-query';
import type { ShelterDto } from '@rf/contracts';
import { api } from './api';

export function useShelters() {
  return useQuery({
    queryKey: ['public', 'shelters'],
    queryFn: async () => (await api<{ shelters: ShelterDto[] }>('GET', '/shelters', undefined, { public: true })).shelters,
    staleTime: 5 * 60_000,
  });
}

export function useAreas() {
  return useQuery({
    queryKey: ['public', 'areas'],
    queryFn: async () => (await api<{ areas: { id: string; label: string }[] }>('GET', '/areas', undefined, { public: true })).areas,
    staleTime: 5 * 60_000,
  });
}
