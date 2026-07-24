import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, readSession, writeSession } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession());
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(Boolean(readSession()));

  const refreshProfile = useCallback(async () => {
    if (!readSession()) {
      setProfile(null);
      return null;
    }
    try {
      const { data } = await api.get('/auth/me');
      setProfile(data);
      return data;
    } catch {
      setProfile(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await refreshProfile();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [refreshProfile]);

  useEffect(() => {
    const onSignedOut = () => {
      setSession(null);
      setProfile(null);
    };
    window.addEventListener('footix:signed-out', onSignedOut);
    return () => window.removeEventListener('footix:signed-out', onSignedOut);
  }, []);

  const persist = useCallback(async (data) => {
    writeSession(data);
    setSession(data);
    const { data: me } = await api.get('/auth/me');
    setProfile(me);
    return me;
  }, []);

  const signup = useCallback(
    async (payload) => {
      const { data } = await api.post('/auth/signup', payload);
      return persist(data);
    },
    [persist]
  );

  const login = useCallback(
    async (payload) => {
      const { data } = await api.post('/auth/login', payload);
      return persist(data);
    },
    [persist]
  );

  const logout = useCallback(async () => {
    const current = readSession();
    writeSession(null);
    setSession(null);
    setProfile(null);
    if (current?.refreshToken) {
      api.post('/auth/logout', { refreshToken: current.refreshToken }).catch(() => {});
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      user: profile?.user || session?.user || null,
      stats: profile?.stats || null,
      rank: profile?.rank || null,
      achievements: profile?.achievements || [],
      isPremium: Boolean(profile?.user?.isPremium),
      isAuthenticated: Boolean(session?.accessToken),
      loading,
      signup,
      login,
      logout,
      refreshProfile,
    }),
    [session, profile, loading, signup, login, logout, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
