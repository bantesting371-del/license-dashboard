import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

// Centralised axios config — no global header mutation leak
const api = axios.create();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const setToken = (token) => {
    if (token) {
      // Validate basic JWT shape before storing
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid token format');
      sessionStorage.setItem('token', token);
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
  };

  const clearToken = () => {
    sessionStorage.removeItem('token');
    delete api.defaults.headers.common['Authorization'];
  };

  const fetchUser = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me');
      setUser(res.data);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const interceptor = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          // Token expired or invalid
          clearToken();
          setUser(null);
        }
        return Promise.reject(error);
      }
    );
    return () => {
      api.interceptors.response.eject(interceptor);
    };
  }, []);

  useEffect(() => {
    const interceptor = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          // Token expired or invalid
          clearToken();
          setUser(null);
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
    return () => {
      api.interceptors.response.eject(interceptor);
    };
  }, []);

  useEffect(() => {
    const token = sessionStorage.getItem('token');
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length !== 3) throw new Error('bad token');
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        fetchUser();
      } catch {
        clearToken();
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, [fetchUser]);

  // Auto-expiry: decode exp from JWT payload (no lib needed)
  useEffect(() => {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp) {
        const msUntilExpiry = payload.exp * 1000 - Date.now();
        if (msUntilExpiry <= 0) { clearToken(); setUser(null); return; }
        const t = setTimeout(() => { clearToken(); setUser(null); }, msUntilExpiry);
        return () => clearTimeout(t);
      }
    } catch { /* non-fatal */ }
  }, [user]);

  const login = async (username, password) => {
    // Basic sanitisation
    if (!username?.trim() || !password) throw new Error('Credentials required');
    const res = await api.post('/api/auth/login', {
      username: username.trim().slice(0, 64),
      password: password.slice(0, 128)
    });
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data;
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  const refreshUser = async () => {
    await fetchUser();
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, refreshUser, api }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

// Export api instance for use in pages
export { api };
