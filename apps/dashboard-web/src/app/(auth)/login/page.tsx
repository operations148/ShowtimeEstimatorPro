'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: 'Google sign-in failed. Please try again.',
  session_expired: 'Your session expired. Please sign in again.',
};

// useSearchParams() requires a Suspense boundary for static prerendering —
// without it `next build` fails with "missing-suspense-with-csr-bailout".
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const errorKey = searchParams?.get('error') ?? '';
  const errorMessage = ERROR_MESSAGES[errorKey] ?? null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-600 text-white font-bold text-xl mb-3">
            E
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Welcome back</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to your EstimatorPro account</p>
        </div>

        {errorMessage && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 mb-5 border border-red-100">
            {errorMessage}
          </div>
        )}

        {/* Google Sign-In button — navigates directly to the API which issues the redirect */}
        <a
          href={`${API_URL}/auth/google`}
          className="flex items-center justify-center gap-3 w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {/* Google "G" logo SVG */}
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </a>

        <p className="text-center text-sm text-gray-400 mt-6">
          No account yet?{' '}
          <Link href="/signup" className="text-brand-600 hover:text-brand-700 font-medium">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
