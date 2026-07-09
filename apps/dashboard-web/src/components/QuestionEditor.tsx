'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { EstimatorQuestion } from '@repo/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const QUESTION_TYPES = [
  { value: 'single', label: 'Single choice' },
  { value: 'multiple', label: 'Multiple choice' },
  { value: 'text', label: 'Text input' },
  { value: 'number', label: 'Number input' },
] as const;

function newQuestion(order: number): EstimatorQuestion {
  return {
    id: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    type: 'single',
    label: '',
    options: [''],
    optionImages: {},
    required: true,
    order,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface UnsplashPhoto {
  id: string;
  thumbUrl: string;
  smallUrl: string;
  regularUrl: string;
  description: string;
  unsplashUrl: string;
}

// ── Image picker modal ────────────────────────────────────────────────────────

function ImagePicker({
  optionLabel,
  currentImageUrl,
  onSelect,
  onClose,
}: {
  optionLabel: string;
  currentImageUrl?: string;
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  // Unsplash search is disabled until an UNSPLASH_ACCESS_KEY is configured server-side;
  // default to device upload and hide the Unsplash tab (the search UI below stays dormant).
  const [tab, setTab] = useState<'unsplash' | 'upload'>('upload');
  const [query, setQuery] = useState(optionLabel);
  const [searchQuery, setSearchQuery] = useState(optionLabel);
  const [page, setPage] = useState(1);
  const [allPhotos, setAllPhotos] = useState<UnsplashPhoto[]>([]);
  const [hasMore, setHasMore] = useState(false);

  // Upload state
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { searchInputRef.current?.focus(); }, []);

  // Reset photos when query changes
  useEffect(() => {
    setAllPhotos([]);
    setPage(1);
    setHasMore(false);
  }, [searchQuery]);

  const { isFetching } = useQuery({
    queryKey: ['unsplash', searchQuery, page],
    queryFn: async () => {
      const res = await api.get<UnsplashPhoto[]>(
        `/media/image-search?q=${encodeURIComponent(searchQuery)}&per_page=9&page=${page}`,
      );
      const photos = res.data ?? [];
      const meta = (res as { meta?: { totalPages?: number } }).meta;
      setAllPhotos((prev) => page === 1 ? photos : [...prev, ...photos]);
      setHasMore(page < (meta?.totalPages ?? 1));
      return photos;
    },
    enabled: tab === 'unsplash' && searchQuery.trim().length > 0,
    staleTime: 1000 * 60 * 5,
  });

  const noKey = !isFetching && allPhotos.length === 0 && searchQuery.trim().length > 0;

  // File select handler
  const handleFile = (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setUploadError('Please use a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setUploadError('Image must be under 6 MB.');
      return;
    }
    setUploadError(null);
    setUploadFile(file);
    setUploadPreview(URL.createObjectURL(file));
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      const res = await fetch(`${API_URL}/media/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': await getCsrfTokenForUpload() },
        body: formData,
      });
      const json = (await res.json()) as { data: { url: string } | null; error: { message: string } | null };
      if (json.error || !json.data) {
        setUploadError(json.error?.message ?? 'Upload failed');
      } else {
        onSelect(json.data.url);
        onClose();
      }
    } catch {
      setUploadError('Upload failed. Check the API server is running.');
    } finally {
      setUploading(false);
    }
  };

  const tabCls = (t: typeof tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? 'border-brand-600 text-brand-600'
        : 'border-transparent text-gray-500 hover:text-gray-700'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[540px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Pick image for "{optionLabel}"</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs (Unsplash hidden until a server-side access key is configured) */}
        <div className="flex border-b border-gray-100 px-4">
          <button className={tabCls('upload')} onClick={() => setTab('upload')}>
            📁 Upload from device
          </button>
        </div>

        {/* Remove current */}
        {currentImageUrl && (
          <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-3">
            <img src={currentImageUrl} alt="" className="w-12 h-8 object-cover rounded" />
            <span className="text-xs text-gray-500 flex-1">Current image</span>
            <button
              onClick={() => { onSelect(''); onClose(); }}
              className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
            >
              Remove
            </button>
          </div>
        )}

        {/* ── Unsplash tab ── */}
        {tab === 'unsplash' && (
          <>
            <div className="px-4 py-2 border-b border-gray-100 flex gap-2">
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { setSearchQuery(query); setPage(1); } }}
                placeholder="Search Unsplash..."
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                onClick={() => { setSearchQuery(query); setPage(1); }}
                disabled={isFetching}
                className="px-3 py-1.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {isFetching ? '...' : 'Search'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {isFetching && allPhotos.length === 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="aspect-[4/3] bg-gray-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              )}

              {noKey && (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500 mb-1">Unsplash not configured</p>
                  <p className="text-xs text-gray-400 mb-2">
                    Add <code className="bg-gray-100 px-1 rounded">UNSPLASH_ACCESS_KEY</code> to{' '}
                    <code className="bg-gray-100 px-1 rounded">apps/api/.env</code>
                  </p>
                  <a href="https://unsplash.com/developers" target="_blank" rel="noreferrer"
                    className="text-xs text-brand-600 hover:underline">
                    Get a free key →
                  </a>
                </div>
              )}

              {allPhotos.length > 0 && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {allPhotos.map((photo) => (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => { onSelect(photo.smallUrl); onClose(); }}
                        className={`relative aspect-[4/3] rounded-lg overflow-hidden border-2 transition-all group ${
                          currentImageUrl === photo.smallUrl
                            ? 'border-brand-500 ring-2 ring-brand-200'
                            : 'border-transparent hover:border-brand-400'
                        }`}
                        title={photo.description}
                      >
                        <img src={photo.thumbUrl} alt={photo.description} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                        {currentImageUrl === photo.smallUrl && (
                          <div className="absolute top-1 right-1 w-5 h-5 bg-brand-500 rounded-full flex items-center justify-center">
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>

                  {hasMore && (
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      disabled={isFetching}
                      className="mt-3 w-full py-2 text-sm text-brand-600 hover:text-brand-700 border border-brand-200 hover:bg-brand-50 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isFetching ? 'Loading...' : 'Load more'}
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="px-4 py-2 border-t border-gray-100">
              <p className="text-[10px] text-gray-400">
                Photos from{' '}
                <a href="https://unsplash.com" target="_blank" rel="noreferrer" className="underline">
                  Unsplash
                </a>
              </p>
            </div>
          </>
        )}

        {/* ── Upload tab ── */}
        {tab === 'upload' && (
          <div className="flex-1 flex flex-col p-4 gap-4">
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors min-h-[200px] ${
                dragOver
                  ? 'border-brand-500 bg-brand-50'
                  : uploadPreview
                  ? 'border-brand-300 bg-brand-50/50'
                  : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50'
              }`}
            >
              {uploadPreview ? (
                <img src={uploadPreview} alt="preview" className="max-h-48 max-w-full rounded-lg object-contain" />
              ) : (
                <>
                  <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M4 16l4-4m0 0l4 4m-4-4v9M4 8a4 4 0 014-4h8a4 4 0 014 4v1" />
                  </svg>
                  <p className="text-sm text-gray-500">Click to select or drag & drop an image</p>
                  <p className="text-xs text-gray-400">PNG or JPEG — WebP preferred. Max 6&nbsp;MB.</p>
                </>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />

            {uploadPreview && (
              <button
                onClick={() => { setUploadPreview(null); setUploadFile(null); }}
                className="text-xs text-gray-400 hover:text-gray-600 text-center transition-colors"
              >
                Choose a different image
              </button>
            )}

            {uploadError && (
              <p className="text-sm text-red-600 text-center">{uploadError}</p>
            )}

            <button
              onClick={handleUpload}
              disabled={!uploadFile || uploading}
              className="w-full py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-40"
            >
              {uploading ? 'Uploading...' : 'Upload & Use This Image'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper: get CSRF token for the raw fetch call used in file upload
async function getCsrfTokenForUpload(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/csrf-token`, { credentials: 'include' });
  const json = (await res.json()) as { data?: { csrfToken?: string } };
  return json.data?.csrfToken ?? '';
}

// ── Option row with image picker trigger ──────────────────────────────────────

function OptionRow({
  optionLabel,
  images,
  index,
  totalOptions,
  onLabelChange,
  onImagesChange,
  onRemove,
}: {
  optionLabel: string;
  images: string[];
  index: number;
  totalOptions: number;
  onLabelChange: (val: string) => void;
  onImagesChange: (urls: string[]) => void;
  onRemove: () => void;
}) {
  // Which image slot the picker is editing (0 or 1); null = closed.
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const canAddMore = images.length < 2;

  const handlePicked = (url: string) => {
    if (pickerSlot === null) return;
    const next = [...images];
    if (url) next[pickerSlot] = url;
    else next.splice(pickerSlot, 1); // "Remove" from the picker clears that slot
    onImagesChange(next.filter(Boolean));
    setPickerSlot(null);
  };

  const thumbBtn = 'flex-shrink-0 w-10 h-7 rounded border-2 border-dashed border-gray-200 hover:border-brand-400 transition-colors overflow-hidden flex items-center justify-center bg-gray-50 group';

  return (
    <>
      <div className="flex gap-2 items-center">
        {/* Image thumbnails (up to 2) + add slot */}
        <div className="flex gap-1 flex-shrink-0">
          {images.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPickerSlot(i)}
              className={thumbBtn}
              title="Change image"
            >
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
          {canAddMore && (
            <button
              type="button"
              onClick={() => setPickerSlot(images.length)}
              className={thumbBtn}
              title={images.length === 0 ? 'Add image' : 'Add 2nd image'}
            >
              <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>

        <input
          type="text"
          value={optionLabel}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder={`Option ${index + 1}`}
          className="flex-1 border border-gray-200 rounded-md px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />

        {totalOptions > 1 && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1 text-gray-300 hover:text-red-500 transition-colors"
            aria-label="Remove option"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {pickerSlot !== null && optionLabel.trim() && (
        <ImagePicker
          optionLabel={optionLabel}
          currentImageUrl={pickerSlot < images.length ? images[pickerSlot] : undefined}
          onSelect={handlePicked}
          onClose={() => setPickerSlot(null)}
        />
      )}

      {pickerSlot !== null && !optionLabel.trim() && (
        <div className="ml-12 text-xs text-amber-600">Type an option label first, then add an image.</div>
      )}
    </>
  );
}

// ── Question row ──────────────────────────────────────────────────────────────

function QuestionRow({
  question,
  index,
  total,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  question: EstimatorQuestion;
  index: number;
  total: number;
  onUpdate: (q: EstimatorQuestion) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasOptions = question.type === 'single' || question.type === 'multiple';

  const updateOptionLabel = (i: number, value: string) => {
    const oldLabel = question.options?.[i] ?? '';
    const options = [...(question.options ?? [])];
    options[i] = value;

    // If the label changed, migrate the image key
    const optionImages = { ...(question.optionImages ?? {}) };
    if (oldLabel && optionImages[oldLabel] !== undefined) {
      optionImages[value] = optionImages[oldLabel]!;
      delete optionImages[oldLabel];
    }

    onUpdate({ ...question, options, optionImages });
  };

  const getOptionImages = (optionLabel: string): string[] => {
    const v = question.optionImages?.[optionLabel];
    if (Array.isArray(v)) return v.filter(Boolean).slice(0, 2);
    if (typeof v === 'string' && v) return [v];
    return [];
  };

  const setOptionImages = (optionLabel: string, urls: string[]) => {
    const optionImages = { ...(question.optionImages ?? {}) };
    const clean = urls.filter(Boolean).slice(0, 2);
    // Store 1 image as a string (legacy shape), 2 as an array, 0 → remove key.
    if (clean.length === 0) delete optionImages[optionLabel];
    else if (clean.length === 1) optionImages[optionLabel] = clean[0]!;
    else optionImages[optionLabel] = clean;
    onUpdate({ ...question, optionImages });
  };

  const addOption = () => {
    onUpdate({ ...question, options: [...(question.options ?? []), ''] });
  };

  const removeOption = (i: number) => {
    const label = question.options?.[i] ?? '';
    const options = (question.options ?? []).filter((_, idx) => idx !== i);
    const optionImages = { ...(question.optionImages ?? {}) };
    delete optionImages[label];
    onUpdate({ ...question, options, optionImages });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {/* Reorder buttons */}
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            aria-label="Move up"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            aria-label="Move down"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        <span className="text-xs text-gray-400 font-mono w-5 text-center">{index + 1}</span>

        <div className="flex-1 flex gap-2">
          <input
            type="text"
            value={question.label}
            onChange={(e) => onUpdate({ ...question, label: e.target.value })}
            placeholder="Question text"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <select
            value={question.type}
            onChange={(e) =>
              onUpdate({
                ...question,
                type: e.target.value as EstimatorQuestion['type'],
                options: e.target.value === 'single' || e.target.value === 'multiple' ? [''] : undefined,
                optionImages: {},
              })
            }
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
          >
            {QUESTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={question.required}
            onChange={(e) => onUpdate({ ...question, required: e.target.checked })}
            className="accent-brand-600"
          />
          Required
        </label>

        {confirmDelete ? (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-red-600">Delete?</span>
            <button type="button" onClick={onDelete} className="text-xs px-2 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors">Yes</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100 rounded-md transition-colors">No</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="p-1.5 text-gray-400 hover:text-red-500 transition-colors shrink-0"
            aria-label="Delete question"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {hasOptions && (
        <div className="ml-9 space-y-1.5">
          <p className="text-[10px] text-gray-400 mb-1.5 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
            </svg>
            Click the image thumbnail to add a photo from your device
          </p>
          {(question.options ?? []).map((opt, i) => (
            <OptionRow
              key={i}
              optionLabel={opt}
              images={getOptionImages(opt)}
              index={i}
              totalOptions={(question.options ?? []).length}
              onLabelChange={(val) => updateOptionLabel(i, val)}
              onImagesChange={(urls) => setOptionImages(opt, urls)}
              onRemove={() => removeOption(i)}
            />
          ))}
          <button
            type="button"
            onClick={addOption}
            className="text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
          >
            + Add option
          </button>
        </div>
      )}
    </div>
  );
}

// ── QuestionEditor (exported) ─────────────────────────────────────────────────

export function QuestionEditor({
  questions,
  onChange,
  isSaving,
  onSave,
  saveError,
  saveOk,
}: {
  questions: EstimatorQuestion[];
  onChange: (questions: EstimatorQuestion[]) => void;
  isSaving: boolean;
  onSave: () => void;
  saveError?: string | null;
  saveOk?: boolean;
}) {
  const addQuestion = () => onChange([...questions, newQuestion(questions.length)]);

  const updateQuestion = useCallback((index: number, q: EstimatorQuestion) => {
    const updated = [...questions];
    updated[index] = q;
    onChange(updated);
  }, [questions, onChange]);

  const deleteQuestion = (index: number) => {
    onChange(questions.filter((_, i) => i !== index).map((q, i) => ({ ...q, order: i })));
  };

  const moveQuestion = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= questions.length) return;
    const updated = [...questions];
    [updated[index], updated[newIndex]] = [updated[newIndex]!, updated[index]!];
    onChange(updated.map((q, i) => ({ ...q, order: i })));
  };

  return (
    <div>
      <div className="space-y-2 mb-4">
        {questions.length === 0 ? (
          <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-500">No questions yet. Add your first question below.</p>
          </div>
        ) : (
          questions.map((q, i) => (
            <QuestionRow
              key={q.id}
              question={q}
              index={i}
              total={questions.length}
              onUpdate={(updated) => updateQuestion(i, updated)}
              onDelete={() => deleteQuestion(i)}
              onMoveUp={() => moveQuestion(i, 'up')}
              onMoveDown={() => moveQuestion(i, 'down')}
            />
          ))
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addQuestion}
          className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add question
        </button>

        {questions.length > 0 && (
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save questions'}
          </button>
        )}
        {saveOk && !isSaving && (
          <span className="text-sm font-medium text-green-600">Saved ✓</span>
        )}
      </div>

      {saveError && (
        <p className="mt-3 text-sm text-red-600 whitespace-pre-wrap break-words max-w-2xl">
          Could not save: {saveError}
        </p>
      )}
    </div>
  );
}
