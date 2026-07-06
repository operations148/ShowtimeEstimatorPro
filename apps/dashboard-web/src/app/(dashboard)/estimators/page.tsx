'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Estimator } from '@repo/shared';

function StatusBadge({ status }: { status: 'draft' | 'published' }) {
  return status === 'published' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      Published
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      Draft
    </span>
  );
}

function CreateEstimatorDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (title: string) =>
      api.post<Estimator & { questions: unknown[] }>('/estimators', { title }),
    onSuccess: (res) => {
      if (res.error) { setError(res.error.message); return; }
      onCreated(res.data!.id);
    },
    onError: () => setError('Failed to create estimator'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">New Estimator</h2>
        {error && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 mb-4 border border-red-100">
            {error}
          </div>
        )}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Pool Cost Estimator"
            autoFocus
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!title.trim() || mutation.isPending}
            onClick={() => mutation.mutate(title.trim())}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EstimatorsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: estimators, isLoading } = useQuery({
    queryKey: ['estimators'],
    queryFn: () => api.get<Estimator[]>('/estimators').then((r) => r.data ?? []),
  });

  const handleCreated = (id: string) => {
    queryClient.invalidateQueries({ queryKey: ['estimators'] });
    setShowCreate(false);
    router.push(`/estimators/${id}`);
  };

  return (
    <>
      {showCreate && (
        <CreateEstimatorDialog onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}

      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Estimators</h2>
          <p className="text-sm text-gray-500 mt-1">Manage your embeddable price estimators</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Estimator
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
              <div className="h-5 bg-gray-200 rounded w-2/3 mb-3" />
              <div className="h-4 bg-gray-100 rounded w-1/3 mb-4" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : !estimators || estimators.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-gray-900 font-medium mb-1">No estimators yet</p>
          <p className="text-sm text-gray-500 mb-4">Create your first one to start capturing leads.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors"
          >
            Create your first estimator
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {estimators.map((est) => (
            <Link
              key={est.id}
              href={`/estimators/${est.id}`}
              className="group bg-white rounded-xl border border-gray-200 p-5 hover:border-brand-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-medium text-gray-900 group-hover:text-brand-700 transition-colors truncate pr-2">
                  {est.title}
                </h3>
                <StatusBadge status={est.status} />
              </div>
              <p className="text-xs text-gray-400 font-mono mb-3 truncate">{est.publicKey}</p>
              <p className="text-xs text-gray-400">
                Created {new Date(est.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
