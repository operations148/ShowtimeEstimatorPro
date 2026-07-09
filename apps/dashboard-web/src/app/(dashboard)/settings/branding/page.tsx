'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthContext } from '@/lib/auth-context';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

interface TenantWithBranding {
  id: string;
  name: string;
  slug: string;
  branding?: { logoUrl?: string; primaryColor?: string; fontFamily?: string; bookingUrl?: string } | null;
}

const FONT_OPTIONS = [
  { value: '', label: 'System default' },
  { value: 'Inter', label: 'Inter' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Open Sans', label: 'Open Sans' },
  { value: 'Lato', label: 'Lato' },
  { value: 'Poppins', label: 'Poppins' },
  { value: 'Nunito', label: 'Nunito' },
];

async function getCsrfTokenForUpload(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/csrf-token`, { credentials: 'include' });
  const json = (await res.json()) as { data?: { csrfToken?: string } };
  return json.data?.csrfToken ?? '';
}

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
        type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      {message}
    </div>
  );
}

// Widget preview component
function WidgetPreview({
  primaryColor,
  fontFamily,
  logoUrl,
  orgName,
}: {
  primaryColor: string;
  fontFamily: string;
  logoUrl: string;
  orgName: string;
}) {
  const font = fontFamily || 'system-ui, sans-serif';
  return (
    <div
      className="border border-gray-200 rounded-xl overflow-hidden shadow-sm"
      style={{ fontFamily: font, maxWidth: 360 }}
    >
      <div style={{ backgroundColor: primaryColor }} className="px-5 py-4">
        <div className="flex items-center gap-3">
          {logoUrl && <img src={logoUrl} alt="Logo" className="h-8 w-auto object-contain rounded" />}
          <div>
            <p className="text-white font-semibold text-sm">{orgName}</p>
            <p className="text-white/70 text-xs">Get an instant estimate</p>
          </div>
        </div>
      </div>

      <div className="bg-white p-5">
        <p className="text-gray-700 font-medium text-sm mb-4">What type of service do you need?</p>
        <div className="space-y-2 mb-4">
          {['Installation', 'Repair', 'Maintenance'].map((opt) => (
            <label key={opt} className="flex items-center gap-2.5 cursor-pointer group">
              <span
                className="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                style={{ borderColor: primaryColor }}
              >
                {opt === 'Installation' && (
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: primaryColor }} />
                )}
              </span>
              <span className="text-sm text-gray-700">{opt}</span>
            </label>
          ))}
        </div>
        <button
          className="w-full py-2.5 rounded-lg text-white text-sm font-medium"
          style={{ backgroundColor: primaryColor }}
        >
          Reveal Your Price
        </button>
      </div>
    </div>
  );
}

export default function BrandingPage() {
  const { refetch: refetchAuth } = useAuthContext();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  const [fontFamily, setFontFamily] = useState('');
  const [bookingUrl, setBookingUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: tenant } = useQuery({
    queryKey: ['tenant-detail'],
    queryFn: () => api.get<TenantWithBranding>('/tenants/me').then((r) => r.data),
  });

  // Hydrate the form from the tenant's saved branding once loaded.
  useEffect(() => {
    if (!tenant) return;
    setLogoUrl(tenant.branding?.logoUrl ?? '');
    setPrimaryColor(tenant.branding?.primaryColor ?? '#2563eb');
    setFontFamily(tenant.branding?.fontFamily ?? '');
    setBookingUrl(tenant.branding?.bookingUrl ?? '');
  }, [tenant]);

  // Upload the logo to the server (returns a hosted URL) rather than embedding base64.
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      showToast('Please use a PNG, JPEG, or WebP image.', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      showToast('Image must be under 6 MB.', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/media/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': await getCsrfTokenForUpload() },
        body: formData,
      });
      const json = (await res.json()) as { data: { url: string } | null; error: { message: string } | null };
      if (json.error || !json.data) {
        showToast(json.error?.message ?? 'Logo upload failed', 'error');
      } else {
        setLogoUrl(json.data.url);
      }
    } catch {
      showToast('Logo upload failed. Is the API server running?', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(primaryColor);
  const bookingTrimmed = bookingUrl.trim();
  const isValidBooking = bookingTrimmed === '' || /^https?:\/\/.+/i.test(bookingTrimmed);

  const saveMutation = useMutation({
    mutationFn: () => {
      const branding: Record<string, string> = {};
      if (logoUrl) branding.logoUrl = logoUrl;
      if (isValidHex) branding.primaryColor = primaryColor;
      if (fontFamily) branding.fontFamily = fontFamily;
      if (bookingTrimmed) branding.bookingUrl = bookingTrimmed;
      return api.patch('/tenants/me', { branding });
    },
    onSuccess: async (res) => {
      if (res.error) {
        showToast(res.error.message, 'error');
        return;
      }
      await refetchAuth(); // refresh the sidebar logo immediately
      showToast('Branding saved — it now applies to your widgets', 'success');
    },
    onError: () => showToast('Could not save branding', 'error'),
  });

  return (
    <>
      {toast && <Toast {...toast} />}

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Controls */}
        <div className="flex-1 max-w-sm space-y-6">
          <div>
            <h3 className="text-base font-medium text-gray-900 mb-1">Organization branding</h3>
            <p className="text-sm text-gray-500">
              Your logo, color, and font sync automatically to every estimator widget you embed.
              (Individual estimators can still override these from their Branding tab.)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Logo</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleLogoUpload}
              className="hidden"
            />
            <div className="flex items-center gap-3">
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  className="h-10 w-auto object-contain rounded border border-gray-200 bg-gray-50 p-1"
                />
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-gray-700 font-medium transition-colors disabled:opacity-60"
              >
                {uploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl('')}
                  className="text-sm text-gray-400 hover:text-red-500 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">PNG or JPEG — WebP preferred. Max 6&nbsp;MB.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primary color</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={isValidHex ? primaryColor : '#2563eb'}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-10 h-9 rounded border border-gray-300 cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => {
                  if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setPrimaryColor(e.target.value);
                }}
                maxLength={7}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Font family</label>
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Booking calendar URL</label>
            <input
              type="url"
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              placeholder="https://app.yourcrm.com/widget/booking/…"
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                isValidBooking ? 'border-gray-300' : 'border-red-400'
              }`}
            />
            <p className="text-xs text-gray-400 mt-1.5">
              Optional. Paste your GoHighLevel (or other) calendar link. When set, the widget shows a
              &ldquo;Book Your Appointment&rdquo; button after the estimate, opening a branded scheduling page.
            </p>
            {!isValidBooking && (
              <p className="text-xs text-red-500 mt-1">Enter a full URL starting with https://</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || uploading || !isValidBooking}
            className="px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save branding'}
          </button>
        </div>

        {/* Live preview */}
        <div className="flex-1">
          <h3 className="text-base font-medium text-gray-900 mb-4">Live preview</h3>
          <WidgetPreview
            primaryColor={isValidHex ? primaryColor : '#2563eb'}
            fontFamily={fontFamily}
            logoUrl={logoUrl}
            orgName={tenant?.name ?? 'Your Company'}
          />
        </div>
      </div>
    </>
  );
}
