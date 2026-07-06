'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/lib/auth-context';

export default function RootPage() {
  const { isAuthenticated, isLoading } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      router.replace(isAuthenticated ? '/dashboard' : '/login');
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-6 h-6 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
