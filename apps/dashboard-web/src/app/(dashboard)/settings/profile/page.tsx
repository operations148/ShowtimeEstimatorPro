'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  notificationRecipients: string[] | null;
  serviceAreaBehavior: string;
}

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
      type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
    }`}>
      {message}
    </div>
  );
}

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [name, setName] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['tenant-detail'],
    queryFn: () => api.get<TenantDetail>('/tenants/me').then((r) => r.data),
  });

  useEffect(() => {
    if (tenant) {
      setName(tenant.name);
      setRecipients(tenant.notificationRecipients ?? []);
    }
  }, [tenant]);

  const saveMutation = useMutation({
    mutationFn: (payload: { name?: string; notificationRecipients?: string[] }) =>
      api.patch('/tenants/me', payload),
    onSuccess: (res) => {
      if (res.error) { showToast(res.error.message, 'error'); return; }
      queryClient.invalidateQueries({ queryKey: ['tenant-detail'] });
      showToast('Saved successfully', 'success');
    },
    onError: () => showToast('Save failed', 'error'),
  });

  const addRecipient = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || recipients.includes(email)) return;
    const updated = [...recipients, email];
    setRecipients(updated);
    setNewEmail('');
    saveMutation.mutate({ notificationRecipients: updated });
  };

  const removeRecipient = (email: string) => {
    const updated = recipients.filter((r) => r !== email);
    setRecipients(updated);
    saveMutation.mutate({ notificationRecipients: updated });
  };

  if (isLoading) {
    return (
      <div className="max-w-lg space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="h-10 bg-gray-100 rounded" />
        <div className="h-10 bg-gray-100 rounded" />
      </div>
    );
  }

  return (
    <>
      {toast && <Toast {...toast} />}

      <div className="max-w-lg space-y-8">
        {/* Organization name */}
        <section>
          <h3 className="text-base font-medium text-gray-900 mb-4">Organization</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Organization name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">URL slug</label>
              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                <span className="px-3 py-2 text-sm text-gray-400 border-r border-gray-200 select-none">app/</span>
                <span className="px-3 py-2 text-sm text-gray-500 font-mono">{tenant?.slug}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">Slug cannot be changed after creation.</p>
            </div>
            <button
              onClick={() => saveMutation.mutate({ name })}
              disabled={saveMutation.isPending || name === tenant?.name}
              className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </section>

        <hr className="border-gray-200" />

        {/* Notification recipients */}
        <section>
          <h3 className="text-base font-medium text-gray-900 mb-1">Lead notifications</h3>
          <p className="text-sm text-gray-500 mb-4">
            These addresses receive an email when a new submission comes in.
          </p>

          <div className="space-y-2 mb-3">
            {recipients.length === 0 ? (
              <p className="text-sm text-gray-400">No recipients yet.</p>
            ) : (
              recipients.map((email) => (
                <div key={email} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-900">{email}</span>
                  <button
                    onClick={() => removeRecipient(email)}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                    aria-label={`Remove ${email}`}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
              placeholder="email@company.com"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              onClick={addRecipient}
              disabled={!newEmail.trim()}
              className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              Add
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
