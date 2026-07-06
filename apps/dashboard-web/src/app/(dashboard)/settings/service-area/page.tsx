'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
      type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
    }`}>
      {message}
    </div>
  );
}

interface ServiceAreaData {
  zips: string[];
  count: number;
}

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  serviceAreaBehavior: 'block' | 'warn';
}

export default function ServiceAreaPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [newZip, setNewZip] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [uploading, setUploading] = useState(false);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: areaData, isLoading: loadingZips } = useQuery({
    queryKey: ['service-area'],
    queryFn: () => api.get<ServiceAreaData>('/service-areas').then((r) => r.data),
  });

  const { data: tenant } = useQuery({
    queryKey: ['tenant-detail'],
    queryFn: () => api.get<TenantDetail>('/tenants/me').then((r) => r.data),
  });

  const zips = areaData?.zips ?? [];

  // Upload CSV file
  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/service-areas/import`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const json = await res.json() as { data: { imported: number } | null; error: { message: string } | null };
      if (json.error) { showToast(json.error.message, 'error'); return; }
      queryClient.invalidateQueries({ queryKey: ['service-area'] });
      showToast(`Imported ${json.data?.imported ?? 0} zip codes`, 'success');
    } catch {
      showToast('Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Add single zip
  const addZipMutation = useMutation({
    mutationFn: (zip: string) => {
      const csv = [...zips, zip].join('\n');
      return fetch(`${API_URL}/service-areas/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'text/csv' },
        body: 'zip\n' + csv,
      }).then((r) => r.json());
    },
    onSuccess: (json: { error?: { message: string } }) => {
      if (json.error) { showToast(json.error.message, 'error'); return; }
      setNewZip('');
      queryClient.invalidateQueries({ queryKey: ['service-area'] });
      showToast('Zip added', 'success');
    },
    onError: () => showToast('Failed to add zip', 'error'),
  });

  // Remove single zip
  const removeZipMutation = useMutation({
    mutationFn: (zip: string) => {
      const updated = zips.filter((z) => z !== zip);
      return fetch(`${API_URL}/service-areas/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'text/csv' },
        body: updated.length > 0 ? 'zip\n' + updated.join('\n') : 'zip\n',
      }).then((r) => r.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['service-area'] }),
    onError: () => showToast('Failed to remove zip', 'error'),
  });

  // Clear all
  const clearMutation = useMutation({
    mutationFn: () => api.delete('/service-areas'),
    onSuccess: (res) => {
      if (res.error) { showToast(res.error.message, 'error'); return; }
      setConfirmClear(false);
      queryClient.invalidateQueries({ queryKey: ['service-area'] });
      showToast('All zip codes cleared', 'success');
    },
    onError: () => showToast('Clear failed', 'error'),
  });

  // Toggle behavior
  const behaviorMutation = useMutation({
    mutationFn: (behavior: 'block' | 'warn') => api.patch('/tenants/me', { serviceAreaBehavior: behavior }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant-detail'] }),
  });

  return (
    <>
      {toast && <Toast {...toast} />}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
      />

      <div className="max-w-2xl space-y-8">
        {/* Header row with stats + actions */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-gray-900">Zip codes</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {loadingZips ? '…' : zips.length === 0
                ? 'No restrictions — widget accepts all locations'
                : `${zips.length} zip code${zips.length !== 1 ? 's' : ''} configured`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {uploading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              )}
              {uploading ? 'Uploading…' : 'Upload CSV'}
            </button>
            {zips.length > 0 && (
              confirmClear ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-sm text-red-600">Clear all?</span>
                  <button
                    onClick={() => clearMutation.mutate()}
                    disabled={clearMutation.isPending}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {clearMutation.isPending ? '…' : 'Yes'}
                  </button>
                  <button onClick={() => setConfirmClear(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="px-3 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Clear all
                </button>
              )
            )}
          </div>
        </div>

        {/* Add single zip */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newZip}
            onChange={(e) => setNewZip(e.target.value.replace(/\D/g, '').slice(0, 10))}
            onKeyDown={(e) => e.key === 'Enter' && newZip.trim() && addZipMutation.mutate(newZip.trim())}
            placeholder="Enter a zip code"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={() => newZip.trim() && addZipMutation.mutate(newZip.trim())}
            disabled={!newZip.trim() || addZipMutation.isPending}
            className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            Add zip
          </button>
        </div>

        {/* Zip chips */}
        {loadingZips ? (
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-7 w-20 bg-gray-100 rounded-full animate-pulse" />
            ))}
          </div>
        ) : zips.length === 0 ? (
          <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-500 mb-1">No zip codes configured</p>
            <p className="text-xs text-gray-400">Upload a CSV or add individual zips above</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto">
            {zips.map((zip) => (
              <span
                key={zip}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full border border-gray-200"
              >
                {zip}
                <button
                  onClick={() => removeZipMutation.mutate(zip)}
                  className="text-gray-400 hover:text-red-500 transition-colors leading-none"
                  aria-label={`Remove ${zip}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <hr className="border-gray-200" />

        {/* Behavior toggle */}
        <section>
          <h3 className="text-base font-medium text-gray-900 mb-1">Out-of-area behavior</h3>
          <p className="text-sm text-gray-500 mb-4">
            What happens when a visitor's zip is not in your service area.
          </p>
          <div className="flex flex-col gap-2 max-w-sm">
            {(['block', 'warn'] as const).map((b) => (
              <label key={b} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="radio"
                  name="behavior"
                  value={b}
                  checked={tenant?.serviceAreaBehavior === b}
                  onChange={() => behaviorMutation.mutate(b)}
                  className="mt-0.5 accent-brand-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {b === 'block' ? 'Block' : 'Warn'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {b === 'block'
                      ? 'Show "not in service area" and stop the flow'
                      : 'Show a warning but allow the visitor to continue'}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
