'use client';

import { ReactQueryProvider } from '@/lib/query-provider';
import { AuthProvider } from '@/lib/auth-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ReactQueryProvider>
      <AuthProvider>{children}</AuthProvider>
    </ReactQueryProvider>
  );
}
