import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { SessionDto } from '@rf/contracts';
import { api, ApiError, setCsrfToken, setUnauthenticatedHandler } from './api';

interface SessionState {
  session: SessionDto | null;
  loading: boolean;
  /** Store a session returned by login/register/recover/MFA without refetching. */
  adopt: (session: SessionDto) => void;
  signOut: () => Promise<void>;
  /** Local end of a session that the server has already expired: clear everything. */
  endSession: () => void;
  refresh: () => Promise<unknown>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const s = await api<SessionDto>('GET', '/auth/session', undefined, { public: true });
        setCsrfToken(s.csrfToken);
        return s;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setCsrfToken(null);
          return null;
        }
        throw e;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  /** Drop every cached private response, e.g. on logout, expiry or account switch. */
  const clearPrivateState = useCallback(() => {
    setCsrfToken(null);
    queryClient.clear();
    queryClient.setQueryData(['session'], null);
  }, [queryClient]);

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      const hadSession = !!queryClient.getQueryData(['session']);
      clearPrivateState();
      if (hadSession) navigate('/signin?ended=1', { replace: true });
    });
    return () => setUnauthenticatedHandler(null);
  }, [clearPrivateState, navigate, queryClient]);

  const adopt = useCallback(
    (s: SessionDto) => {
      // A different account may have used this tab before: start from an empty cache.
      queryClient.clear();
      setCsrfToken(s.csrfToken);
      queryClient.setQueryData(['session'], s);
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api('POST', '/auth/logout', {});
    } catch {
      // Even if the network call fails, clear everything locally.
    }
    clearPrivateState();
    navigate('/signed-out', { replace: true });
  }, [clearPrivateState, navigate]);

  const endSession = useCallback(() => {
    clearPrivateState();
    navigate('/signin?ended=1', { replace: true });
  }, [clearPrivateState, navigate]);

  const value = useMemo<SessionState>(
    () => ({ session: query.data ?? null, loading: query.isPending, adopt, signOut, endSession, refresh: query.refetch }),
    [query.data, query.isPending, adopt, signOut, endSession, query.refetch],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
