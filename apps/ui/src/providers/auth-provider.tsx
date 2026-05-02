'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

interface AuthState {
  token: string | null;
  user: { username: string; groups: string[] } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<{ username: string; groups: string[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('codenexus_token');
    if (stored) {
      try {
        const payload = JSON.parse(atob(stored.split('.')[1]));
        setToken(stored);
        setUser({ username: payload.sub, groups: payload.groups || [] });
      } catch {
        localStorage.removeItem('codenexus_token');
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_AUTH_URL || 'http://localhost:9000'}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error('Login failed');
    const data = await res.json();
    try {
      const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
      setToken(data.accessToken);
      localStorage.setItem('codenexus_token', data.accessToken);
      setUser({ username: payload.sub, groups: payload.groups || [] });
    } catch { /* ignore */ }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('codenexus_token');
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, isAuthenticated: !!token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
