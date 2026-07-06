'use client';

import { useState, useEffect, Suspense } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthContext } from '@/lib/auth-context';

interface Subscription {
  id: string;
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'unpaid';
  externalId: string;
  currentPeriodEnd: string | number | null;
  createdAt: string;
}

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
      type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
    }`}>
      {message}
      <button onClick={onClose} className="opacity-70 hover:opacity-100">×</button>
    </div>
  );
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'bg-green-50 text-green-700 border-green-200' },
  trialing: { label: 'Trial', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  past_due: { label: 'Past due', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  canceled: { label: 'Canceled', color: 'bg-gray-100 text-gray-600 border-gray-200' },
  unpaid: { label: 'Unpaid', color: 'bg-red-50 text-red-700 border-red-200' },
};

function fmtDate(val: string | number | null) {
  if (!val) return '—';
  const d = typeof val === 'number' ? new Date(val * 1000) : new Date(val);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function BillingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant } = useAuthContext();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Handle ?success=true and ?canceled=true
  useEffect(() => {
    if (searchParams?.get('success') === 'true') {
      setToast({ message: 'Subscription activated successfully!', type: 'success' });
      router.replace('/settings/billing');
    } else if (searchParams?.get('canceled') === 'true') {
      setToast({ message: 'Checkout canceled. No changes were made.', type: 'error' });
      router.replace('/settings/billing');
    }
  }, [searchParams, router]);

  const { data: subscription, isLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get<Subscription | null>('/billing/subscription').then((r) => r.data ?? null),
  });

  const checkoutMutation = useMutation({
    mutationFn: () => api.post<{ checkoutUrl: string }>('/billing/checkout', {}),
    onSuccess: (res) => {
      if (res.error) { setToast({ message: res.error.message, type: 'error' }); return; }
      if (res.data?.checkoutUrl) window.location.href = res.data.checkoutUrl;
    },
    onError: () => setToast({ message: 'Failed to start checkout', type: 'error' }),
  });

  const portalMutation = useMutation({
    mutationFn: () => api.post<{ portalUrl: string }>('/billing/portal'),
    onSuccess: (res) => {
      if (res.error) { setToast({ message: res.error.message, type: 'error' }); return; }
      if (res.data?.portalUrl) window.location.href = res.data.portalUrl;
    },
    onError: () => setToast({ message: 'Failed to open billing portal', type: 'error' }),
  });

  const hasActiveSub = subscription?.status === 'active' || subscription?.status === 'trialing';
  const statusInfo = subscription ? (STATUS_LABELS[subscription.status] ?? STATUS_LABELS.canceled) : null;

  return (
    <>
      {toast && <Toast {...toast} type={toast.type} onClose={() => setToast(null)} />}

      <div className="max-w-lg space-y-6">
        <h3 className="text-base font-medium text-gray-900">Subscription</h3>

        {isLoading ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 animate-pulse">
            <div className="h-5 bg-gray-200 rounded w-1/3 mb-3" />
            <div className="h-4 bg-gray-100 rounded w-1/2 mb-4" />
            <div className="h-10 bg-gray-100 rounded w-32" />
          </div>
        ) : !subscription ? (
          /* No subscription */
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">No active subscription</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  Subscribe to unlock full platform features and remove limits.
                </p>
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-5">
              <p className="text-sm font-semibold text-gray-900 mb-1">Pro Plan</p>
              <ul className="text-xs text-gray-600 space-y-1">
                <li>✓ Unlimited estimators</li>
                <li>✓ Unlimited submissions</li>
                <li>✓ CSV exports</li>
                <li>✓ Analytics dashboard</li>
                <li>✓ Team members</li>
              </ul>
            </div>

            <button
              onClick={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending}
              className="w-full py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {checkoutMutation.isPending ? 'Redirecting to checkout…' : 'Subscribe'}
            </button>
          </div>
        ) : (
          /* Active / past due / canceled subscription */
          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
            {/* Status */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Pro Plan</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Member since {fmtDate(subscription.createdAt)}
                </p>
              </div>
              {statusInfo && (
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
              )}
            </div>

            {/* Period end */}
            {subscription.currentPeriodEnd && (
              <div className="bg-gray-50 border border-gray-100 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-500">
                  {subscription.status === 'canceled' ? 'Access ends' : 'Next billing date'}
                </p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">
                  {fmtDate(subscription.currentPeriodEnd)}
                </p>
              </div>
            )}

            {/* Past due warning */}
            {subscription.status === 'past_due' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                Your payment failed. Update your payment method to restore full access.
              </div>
            )}

            {/* Unpaid warning */}
            {subscription.status === 'unpaid' && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
                Your account is unpaid. Platform access is restricted until payment is resolved.
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              {hasActiveSub || subscription.status === 'past_due' ? (
                <button
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                  className="flex-1 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {portalMutation.isPending ? 'Opening portal…' : 'Manage billing'}
                </button>
              ) : (
                <button
                  onClick={() => checkoutMutation.mutate()}
                  disabled={checkoutMutation.isPending}
                  className="flex-1 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {checkoutMutation.isPending ? 'Redirecting…' : 'Resubscribe'}
                </button>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400">
          Payments are processed securely by Stripe. We never store your card details.
        </p>
      </div>
    </>
  );
}

export default function BillingPage() {
  // Wrap in Suspense because useSearchParams() requires it in Next.js App Router
  return (
    <Suspense fallback={<div className="h-40 bg-gray-100 rounded-xl animate-pulse" />}>
      <BillingContent />
    </Suspense>
  );
}
