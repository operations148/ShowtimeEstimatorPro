'use client';

import { useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: false,
    error: null,
  });

  const requestOtp = useCallback(async (identifier: string, channel: 'email' | 'sms') => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    const res = await api.post('/auth/otp/request', { identifier, channel });
    if (res.error) {
      setState((s) => ({ ...s, isLoading: false, error: res.error!.message }));
      return false;
    }
    setState((s) => ({ ...s, isLoading: false }));
    return true;
  }, []);

  const verifyOtp = useCallback(async (identifier: string, code: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    const res = await api.post('/auth/otp/verify', { identifier, code });
    if (res.error) {
      setState((s) => ({ ...s, isLoading: false, error: res.error!.message }));
      return false;
    }
    setState({ isAuthenticated: true, isLoading: false, error: null });
    return true;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setState({ isAuthenticated: false, isLoading: false, error: null });
  }, []);

  return { ...state, requestOtp, verifyOtp, logout };
}
