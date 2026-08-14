import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { Permission, SessionContext } from '@nexa/types';
import { api, setActiveBusiness } from '@/lib/api';

/**
 * Session context.
 *
 * The server is the source of truth: this bootstraps from `GET /api/auth/session`
 * and re-reads after every auth or workspace change. Permissions held here are
 * used *only* to hide affordances — every action is authorised again server-side.
 */

interface SessionValue {
  session: SessionContext | null;
  loading: boolean;
  isAuthenticated: boolean;
  needsOnboarding: boolean;
  currency: string;
  locale: string;
  can: (permission: Permission) => boolean;
  refresh: () => Promise<void>;
  applySession: (session: SessionContext) => void;
  signOut: () => Promise<void>;
}

const SessionCtx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<SessionContext>('/auth/session'),
    retry: false,
    staleTime: 30_000,
  });

  const session = data?.user ? data : null;

  useEffect(() => {
    if (session?.business) setActiveBusiness(session.business.id);
  }, [session?.business?.id]);

  const applySession = useCallback(
    (next: SessionContext) => {
      if (next.business) setActiveBusiness(next.business.id);
      queryClient.setQueryData(['session'], next);
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');
    setActiveBusiness(null);
    // Drop every cached query — none of it belongs to the next user.
    queryClient.clear();
    window.location.href = '/';
  }, [queryClient]);

  const value = useMemo<SessionValue>(() => {
    const permissions = new Set(session?.permissions ?? []);
    return {
      session,
      loading: isLoading,
      isAuthenticated: Boolean(session?.user),
      needsOnboarding: Boolean(session?.user && !session.business),
      currency: session?.business?.currency ?? 'GHS',
      locale: session?.business?.locale ?? 'en-GH',
      can: (permission) => permissions.has(permission),
      refresh,
      applySession,
      signOut,
    };
  }, [session, isLoading, refresh, applySession, signOut]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionCtx);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>.');
  return context;
}

/** Convenience for the many components that only need money formatting. */
export function useMoney() {
  const { currency, locale } = useSession();
  return { currency, locale };
}
