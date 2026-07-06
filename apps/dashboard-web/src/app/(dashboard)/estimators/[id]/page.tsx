'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { QuestionEditor } from '@/components/QuestionEditor';
import type { Estimator, EstimatorQuestion } from '@repo/shared';

type Tab = 'questions' | 'pricing' | 'branding';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Publish/Unpublish button ─────────────────────────────────────────────────

function PublishToggle({
  estimatorId,
  status,
  onToggled,
}: {
  estimatorId: string;
  status: 'draft' | 'published';
  onToggled: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const action = status === 'published' ? 'unpublish' : 'publish';

  const mutation = useMutation({
    mutationFn: () => api.post(`/estimators/${estimatorId}/${action}`),
    onSuccess: () => { setConfirm(false); onToggled(); },
  });

  if (confirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">
          {action === 'unpublish'
            ? 'Unpublish this estimator? The widget will stop working.'
            : 'Publish and make the widget live?'}
        </span>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 ${
            action === 'unpublish'
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {mutation.isPending ? 'Working...' : `Yes, ${action}`}
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 ${
        status === 'published'
          ? 'border border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-gray-400'
          : 'bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-500'
      }`}
    >
      {status === 'published' ? 'Unpublish' : 'Publish'}
    </button>
  );
}

// ── Embed Code Dialog ────────────────────────────────────────────────────────

function EmbedCodeDialog({
  estimatorId,
  onClose,
}: {
  estimatorId: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['estimator-embed', estimatorId],
    queryFn: () =>
      api.get<{ snippet: string; publicKey: string }>(`/estimators/${estimatorId}/embed-code`).then((r) => r.data),
  });

  const copySnippet = () => {
    if (!data?.snippet) return;
    navigator.clipboard.writeText(data.snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Embed Code</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Paste this snippet into your website's HTML where you want the estimator to appear.
        </p>

        {isLoading ? (
          <div className="h-24 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <div className="relative">
            <pre className="bg-gray-950 text-gray-100 rounded-lg p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {data?.snippet}
            </pre>
            <button
              onClick={copySnippet}
              className="absolute top-2 right-2 px-2.5 py-1 bg-white/10 hover:bg-white/20 text-gray-200 text-xs rounded-md transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-4 w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ── Pricing Tab (Visual Editor) ──────────────────────────────────────────────

type PriceCell = { min: string; max: string };

function PricingTab({
  estimatorId,
  questions,
}: {
  estimatorId: string;
  questions: EstimatorQuestion[];
}) {
  // Detect base question (first single-choice), size question (second single-choice),
  // and addon options (all options from multiple-choice questions).
  const singleChoiceQs = questions.filter((q) => q.type === 'single' && (q.options?.length ?? 0) > 0);
  const multiChoiceQs  = questions.filter((q) => q.type === 'multiple' && (q.options?.length ?? 0) > 0);

  const baseQuestion = singleChoiceQs[0] ?? null;
  const sizeQuestion = singleChoiceQs[1] ?? null;
  const baseOptions  = baseQuestion?.options ?? [];
  const sizeOptions  = sizeQuestion?.options ?? [];

  // Addon options: all options from multiple-choice questions + any extra single-choice Qs
  const addonOptions: string[] = [
    ...multiChoiceQs.flatMap((q) => q.options ?? []),
    ...singleChoiceQs.slice(2).flatMap((q) => q.options ?? []),
  ];

  const { data: existing, isLoading } = useQuery({
    queryKey: ['estimator-pricing', estimatorId],
    queryFn: () =>
      api
        .get<{
          currency?: string;
          base?: Record<string, Record<string, [number, number]>>;
          addons?: Record<string, [number, number]>;
        }>(`/estimators/${estimatorId}/pricing`)
        .then((r) => r.data ?? null),
    retry: false,
  });

  // base[baseOpt][sizeOpt] = { min, max }
  const [basePrices, setBasePrices] = useState<Record<string, Record<string, PriceCell>>>({});
  // addons[opt] = { min, max }
  const [addonPrices, setAddonPrices] = useState<Record<string, PriceCell>>({});
  const [currency, setCurrency] = useState('USD');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load existing pricing config into form state
  useEffect(() => {
    if (!existing) return;
    if (existing.currency) setCurrency(existing.currency as string);

    const rawBase = (existing.base ?? {}) as Record<string, Record<string, [number, number]>>;
    const newBase: Record<string, Record<string, PriceCell>> = {};
    for (const bOpt of baseOptions) {
      newBase[bOpt] = {};
      for (const sOpt of sizeOptions) {
        const range = rawBase[bOpt]?.[sOpt];
        newBase[bOpt][sOpt] = {
          min: range ? String(range[0]) : '',
          max: range ? String(range[1]) : '',
        };
      }
    }
    setBasePrices(newBase);

    const rawAddons = (existing.addons ?? {}) as Record<string, [number, number]>;
    const newAddons: Record<string, PriceCell> = {};
    for (const opt of addonOptions) {
      const range = rawAddons[opt];
      newAddons[opt] = { min: range ? String(range[0]) : '', max: range ? String(range[1]) : '' };
    }
    setAddonPrices(newAddons);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  // Initialise empty cells when options change (before data loads)
  useEffect(() => {
    setBasePrices((prev) => {
      const next = { ...prev };
      for (const b of baseOptions) {
        if (!next[b]) next[b] = {};
        for (const s of sizeOptions) {
          if (!next[b][s]) next[b][s] = { min: '', max: '' };
        }
      }
      return next;
    });
    setAddonPrices((prev) => {
      const next = { ...prev };
      for (const opt of addonOptions) {
        if (!next[opt]) next[opt] = { min: '', max: '' };
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions]);

  const setBaseCell = (bOpt: string, sOpt: string, field: 'min' | 'max', value: string) => {
    setBasePrices((prev) => ({
      ...prev,
      [bOpt]: { ...(prev[bOpt] ?? {}), [sOpt]: { ...(prev[bOpt]?.[sOpt] ?? { min: '', max: '' }), [field]: value } },
    }));
  };

  const setAddonCell = (opt: string, field: 'min' | 'max', value: string) => {
    setAddonPrices((prev) => ({
      ...prev,
      [opt]: { ...(prev[opt] ?? { min: '', max: '' }), [field]: value },
    }));
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaveStatus('saving');

    // Convert form state → pricing config JSON
    const base: Record<string, Record<string, [number, number]>> = {};
    for (const bOpt of baseOptions) {
      base[bOpt] = {};
      for (const sOpt of sizeOptions) {
        const cell = basePrices[bOpt]?.[sOpt];
        const mn = Number(cell?.min ?? 0);
        const mx = Number(cell?.max ?? 0);
        if (mn > 0 || mx > 0) base[bOpt][sOpt] = [mn, mx];
      }
    }

    const addons: Record<string, [number, number]> = {};
    for (const opt of addonOptions) {
      const cell = addonPrices[opt];
      const mn = Number(cell?.min ?? 0);
      const mx = Number(cell?.max ?? 0);
      if (mn > 0 || mx > 0) addons[opt] = [mn, mx];
    }

    const payload = { currency, base, addons, minMaxMode: 'sum_ranges' };
    const res = await api.put(`/estimators/${estimatorId}/pricing`, payload);
    setSaveStatus(res.error ? 'error' : 'saved');
    if (res.error) setSaveError(res.error.message);
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  if (isLoading) return <div className="h-24 bg-gray-100 rounded-lg animate-pulse" />;

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="max-w-3xl space-y-8">
      {saveError && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-100">{saveError}</div>
      )}

      {/* Currency */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 w-24">Currency</label>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="USD">USD ($)</option>
          <option value="CAD">CAD (C$)</option>
          <option value="AUD">AUD (A$)</option>
          <option value="GBP">GBP (£)</option>
          <option value="EUR">EUR (€)</option>
        </select>
      </div>

      {/* Base price matrix */}
      {baseQuestion && sizeQuestion ? (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Base Prices</h3>
          <p className="text-xs text-gray-500 mb-4">
            Set a <strong>min</strong> and <strong>max</strong> price for each combination of
            "{baseQuestion.label}" × "{sizeQuestion.label}".
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left pb-2 pr-4 font-medium text-gray-500 text-xs" />
                  {sizeOptions.map((s) => (
                    <th key={s} className="text-center pb-2 px-2 font-medium text-gray-700 text-xs" colSpan={2}>
                      {s}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="pb-2 pr-4" />
                  {sizeOptions.map((s) => (
                    <>
                      <th key={s + '-min'} className="pb-2 px-1 text-xs font-normal text-gray-400 text-center">Min $</th>
                      <th key={s + '-max'} className="pb-2 px-1 text-xs font-normal text-gray-400 text-center">Max $</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {baseOptions.map((bOpt) => (
                  <tr key={bOpt} className="border-t border-gray-100">
                    <td className="py-2 pr-4 font-medium text-gray-700 text-sm whitespace-nowrap">{bOpt}</td>
                    {sizeOptions.map((sOpt) => (
                      <>
                        <td key={sOpt + '-min'} className="py-2 px-1">
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={basePrices[bOpt]?.[sOpt]?.min ?? ''}
                            onChange={(e) => setBaseCell(bOpt, sOpt, 'min', e.target.value)}
                            className={inputCls}
                            style={{ minWidth: 90 }}
                          />
                        </td>
                        <td key={sOpt + '-max'} className="py-2 px-1">
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={basePrices[bOpt]?.[sOpt]?.max ?? ''}
                            onChange={(e) => setBaseCell(bOpt, sOpt, 'max', e.target.value)}
                            className={inputCls}
                            style={{ minWidth: 90 }}
                          />
                        </td>
                      </>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          Add at least two single-choice questions (type + size) in the Questions tab first.
        </div>
      )}

      {/* Add-on prices */}
      {addonOptions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Add-on Prices</h3>
          <p className="text-xs text-gray-500 mb-4">
            Each add-on selected adds its price to the base estimate.
          </p>
          <div className="space-y-2">
            {addonOptions.map((opt) => (
              <div key={opt} className="flex items-center gap-3">
                <span className="text-sm text-gray-700 w-48 flex-shrink-0">{opt}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">Min $</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={addonPrices[opt]?.min ?? ''}
                    onChange={(e) => setAddonCell(opt, 'min', e.target.value)}
                    className={inputCls}
                    style={{ width: 110 }}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">Max $</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={addonPrices[opt]?.max ?? ''}
                    onChange={(e) => setAddonCell(opt, 'max', e.target.value)}
                    className={inputCls}
                    style={{ width: 110 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saveStatus === 'saving'}
        className="px-5 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50"
      >
        {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved!' : 'Save pricing'}
      </button>
    </div>
  );
}

// ── Branding Tab ─────────────────────────────────────────────────────────────

function BrandingTab({
  estimatorId,
  branding,
}: {
  estimatorId: string;
  branding: { logoUrl?: string | null; primaryColor?: string; fontFamily?: string };
}) {
  const queryClient = useQueryClient();
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl ?? '');
  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor ?? '#2563eb');
  const [fontFamily, setFontFamily] = useState(branding.fontFamily ?? '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogoUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    const res = await api.patch(`/estimators/${estimatorId}`, {
      branding: {
        ...(logoUrl ? { logoUrl } : {}),
        primaryColor,
        ...(fontFamily ? { fontFamily } : {}),
      },
    });
    setSaveStatus(res.error ? 'error' : 'saved');
    if (!res.error) queryClient.invalidateQueries({ queryKey: ['estimator', estimatorId] });
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  return (
    <div className="max-w-sm space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Logo</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleLogoUpload}
          className="hidden"
        />
        {logoUrl ? (
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="Logo preview" className="h-12 max-w-[120px] object-contain rounded border border-gray-200 bg-gray-50 p-1" />
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                Change logo
              </button>
              <button
                type="button"
                onClick={() => setLogoUrl('')}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Upload logo from device
          </button>
        )}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Primary color</label>
        <div className="flex gap-2 items-center">
          <input
            type="color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            className="w-10 h-9 rounded border border-gray-300 cursor-pointer p-0.5"
          />
          <input
            type="text"
            value={primaryColor}
            onChange={(e) => {
              if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setPrimaryColor(e.target.value);
            }}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            maxLength={7}
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
          <option value="">System default</option>
          <option value="Inter">Inter</option>
          <option value="Roboto">Roboto</option>
          <option value="Open Sans">Open Sans</option>
          <option value="Lato">Lato</option>
          <option value="Poppins">Poppins</option>
          <option value="Nunito">Nunito</option>
        </select>
      </div>
      <button
        onClick={handleSave}
        disabled={saveStatus === 'saving'}
        className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50"
      >
        {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save branding'}
      </button>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function EstimatorDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('questions');
  const [showEmbed, setShowEmbed] = useState(false);
  const [localQuestions, setLocalQuestions] = useState<EstimatorQuestion[] | null>(null);

  const { data: estimator, isLoading, isError } = useQuery({
    queryKey: ['estimator', id],
    queryFn: () =>
      api.get<Estimator & { questions: EstimatorQuestion[] }>(`/estimators/${id}`).then((r) => r.data),
  });

  // Sync local questions when remote data loads
  useEffect(() => {
    if (estimator?.questions && localQuestions === null) {
      setLocalQuestions(estimator.questions);
    }
  }, [estimator, localQuestions]);

  const saveQuestionsMutation = useMutation({
    mutationFn: (questions: EstimatorQuestion[]) =>
      api.put(`/estimators/${id}/questions`, { questions }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['estimator', id] }),
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: 'questions', label: 'Questions' },
    { key: 'pricing', label: 'Pricing' },
    { key: 'branding', label: 'Branding' },
  ];

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-4 bg-gray-100 rounded w-1/4 mb-8" />
        <div className="h-64 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (isError || !estimator) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500 mb-4">Estimator not found.</p>
        <button
          onClick={() => router.push('/estimators')}
          className="text-sm text-brand-600 hover:text-brand-700"
        >
          ← Back to estimators
        </button>
      </div>
    );
  }

  const questions = localQuestions ?? estimator.questions;

  return (
    <>
      {showEmbed && (
        <EmbedCodeDialog estimatorId={id} onClose={() => setShowEmbed(false)} />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <button
            onClick={() => router.push('/estimators')}
            className="text-xs text-gray-400 hover:text-gray-600 mb-1 flex items-center gap-1 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Estimators
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold text-gray-900">{estimator.title}</h2>
            <StatusBadge status={estimator.status} />
          </div>
          <p className="text-xs text-gray-400 font-mono mt-1">{estimator.publicKey}</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <a
            href={`http://localhost:5173/embed-example.html?key=${estimator.publicKey}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 border border-brand-300 text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            View Estimator
          </a>
          <button
            onClick={() => setShowEmbed(true)}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            Embed
          </button>
          <PublishToggle
            estimatorId={id}
            status={estimator.status}
            onToggled={() => queryClient.invalidateQueries({ queryKey: ['estimator', id] })}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'questions' && (
        <QuestionEditor
          questions={questions}
          onChange={setLocalQuestions}
          isSaving={saveQuestionsMutation.isPending}
          onSave={() => saveQuestionsMutation.mutate(questions)}
        />
      )}
      {activeTab === 'pricing' && <PricingTab estimatorId={id} questions={questions} />}
      {activeTab === 'branding' && (
        <BrandingTab estimatorId={id} branding={estimator.branding ?? {}} />
      )}
    </>
  );
}
