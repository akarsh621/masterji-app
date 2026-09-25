'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, UNAUTHORIZED_EVENT } from '@/lib/api-client';

const AuthContext = createContext(null);

const TOKEN_KEY = 'masterji_token';
const USER_KEY = 'masterji_user';

function readCachedUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [dbMode, setDbMode] = useState('prod');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    api.me()
      .then(data => {
        setUser(data.user);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        if (data.db_mode) setDbMode(data.db_mode);
      })
      .catch(err => {
        if (err?.status === 401) {
          clearSession();
          return;
        }
        // Server restarting or no internet: keep the session and carry on with
        // the last known user rather than forcing everyone to log in again.
        const cached = readCachedUser();
        if (cached) setUser(cached);
      })
      .finally(() => setLoading(false));
  }, []);

  // Any request answered with 401 (login expired, user deactivated) returns to
  // the login screen. The bill being built is kept on the phone and comes back
  // after logging in again.
  useEffect(() => {
    const onUnauthorized = () => {
      clearSession();
      setUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await api.login(credentials);
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setUser(data.user);
    api.me().then(d => { if (d.db_mode) setDbMode(d.db_mode); }).catch(() => {});
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, dbMode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
