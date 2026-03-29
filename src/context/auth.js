'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [dbMode, setDbMode] = useState('prod');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('masterji_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api.me()
      .then(data => {
        setUser(data.user);
        if (data.db_mode) setDbMode(data.db_mode);
      })
      .catch(() => {
        localStorage.removeItem('masterji_token');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await api.login(credentials);
    localStorage.setItem('masterji_token', data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('masterji_token');
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
