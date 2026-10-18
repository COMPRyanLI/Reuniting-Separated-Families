import { useQuery } from '@tanstack/react-query';
import type { NotificationDto } from '@rf/contracts';
import { api } from './api';
import { useSession } from './session';

export const POLL_MS = 15_000;

/**
 * Polls generic notifications every 15 s while the tab is visible (react-query pauses
 * interval refetches in hidden tabs), backs off after failures, and marks requests as
 * background so polling never extends an idle session.
 */
export function useNotifications() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['notifications'],
    enabled: !!session,
    queryFn: () => api<{ notifications: NotificationDto[]; unread: number }>('GET', '/notifications', undefined, { background: true }),
    refetchInterval: (query) => {
      const failures = query.state.fetchFailureCount;
      return failures > 0 ? Math.min(POLL_MS * 2 ** failures, 120_000) : POLL_MS;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
