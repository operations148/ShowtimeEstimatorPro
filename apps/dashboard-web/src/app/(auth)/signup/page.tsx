'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthContext } from '@/lib/auth-context';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refetch } = useAuthContext();

  // google_token is set when coming from the Google OAuth callback (new user)
  const googleToken = searchParams?.get('google_token') ?? '';

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-generate slug from org name
  const handleNameChange = (value: string) => {
    setName(value);
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50),
    );
  };

  // If no google_token present, this page isn't accessible directly — redirect to login
  useEffect(() => {
    if (!googleToken) {
      router.replace('/login');
    }
  }, [googleToken, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const res = await api.post<{ success: boolean }>('/auth/google/setup', {
      name: name.trim(),
      slug: slug.trim(),
      googleToken,
    });

    if (res.error) {
      setError(res.error.message);
      setIsLoading(false);
      return;
    }

    await refetch();
    router.push('/dashboard');
  };

  if (!googleToken) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-600 text-white font-bold text-xl mb-3">
            E
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Create your account</h1>
          <p className="text-sm text-gray-500 mt-1">
            One last step — name your organization
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 mb-5 border border-red-100">
            {error}
            {error.includes('expired') && (
              <span>
                {' '}
                <a href={`${API_URL}/auth/google`} className="underline font-medium">
                  Try signing in again
                </a>
              </span>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Organization name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Organization name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              placeholder="Acme Pools"
              required
              autoFocus
            />
          </div>

          {/* URL slug */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL slug</label>
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-brand-500">
              <span className="bg-gray-50 px-3 py-2 text-sm text-gray-400 border-r border-gray-300 select-none">
                app/
              </span>
              <input
                type="text"
                value={slug}
                onChange={(e) =>
                  setSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, '')
                      .slice(0, 50),
                  )
                }
                className="flex-1 px-3 py-2 text-sm focus:outline-none"
                placeholder="acme-pools"
                pattern="[a-z0-9-]{2,50}"
                required
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">Lowercase letters, numbers, and hyphens only</p>
          </div>

          <button
            type="submit"
            disabled={isLoading || !name.trim() || slug.length < 2}
            className="w-full bg-brand-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {isLoading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
