import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { CurrentUser } from '../api/types';

export interface AuthState {
  readonly current: CurrentUser | null;
  readonly loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setCurrent(await api.get<CurrentUser>('/api/v1/auth/me'));
    } catch {
      setCurrent(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      current,
      loading,
      login: async (email, password) => {
        await api.post('/api/v1/auth/login', { email, password });
        await refresh();
      },
      logout: async () => {
        await api.post('/api/v1/auth/logout');
        setCurrent(null);
      },
    }),
    [current, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
