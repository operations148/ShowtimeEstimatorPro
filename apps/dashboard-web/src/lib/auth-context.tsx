'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  branding?: { logoUrl?: string; primaryColor?: string; fontFamily?: string } | null;
}

interface AuthContextValue {
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<Tenant>('/tenants/me');
      setTenant(res.data ?? null);
    } catch {
      setTenant(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setTenant(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ tenant, isAuthenticated: !!tenant, isLoading, logout, refetch: checkSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}
