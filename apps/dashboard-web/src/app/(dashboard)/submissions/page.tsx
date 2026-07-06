'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SubmissionRow {
  id: string;
  estimatorId: string;
  leadEmail: string;
  leadZip: string;
  leadName: string | null;
  leadPhone: string | null;
  answers: Record<string, unknown>;
  estimateMin: number;
  estimateMax: number;
  currency: string;
  serviceAreaValid: boolean;
  createdAt: string | number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount: number) {
  return '$' + Number(amount).toLocaleString();
}

function fmtDate(val: string | number) {
  const d = typeof val === 'number' ? new Date(val * 1000) : new Date(val);
  return d.toLocaleDateString();
}

// ── CSV Export ────────────────────────────────────────────────────────────────

async function downloadCsv(params: { from?: string; to?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', new Date(params.from).toISOString());
  if (params.to) qs.set('to', new Date(params.to + 'T23:59:59').toISOString());
  const url = `${API_URL}/exports/submissions${qs.size ? '?' + qs.toString() : ''}`;

  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('Export failed');

  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `submissions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(href);
}

// ── Expanded answers row ──────────────────────────────────────────────────────

function AnswersRow({ answers }: { answers: Record<string, unknown> }) {
  const entries = Object.entries(answers);
  if (entries.length === 0) return <p className="text-xs text-gray-400">No answers recorded.</p>;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs text-gray-500 font-medium truncate">{k}</dt>
          <dd className="text-xs text-gray-900">
            {Array.isArray(v) ? v.join(', ') : String(v ?? '—')}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SubmissionsPage() {
  const queryClient = useQueryClient();

  // Filters
  const [search, setSearch] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [page, setPage] = useState(1);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  // Expanded rows
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // CSV export state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Delete confirmation per row
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['submissions'],
    queryFn: () => api.get<SubmissionRow[]>('/submissions').then((r) => r.data ?? []),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/submissions/${id}`),
    onSuccess: (_, id) => {
      setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ['submissions'] });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api.delete(`/submissions/${id}`);
    },
    onSuccess: () => {
      setSelected(new Set());
      setConfirmBulk(false);
      queryClient.invalidateQueries({ queryKey: ['submissions'] });
    },
  });

  // Client-side filtering
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter((s) => {
      if (q) {
        const hay = `${s.leadEmail} ${s.leadZip} ${s.leadName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterFrom) {
        const d = typeof s.createdAt === 'number' ? s.createdAt * 1000 : new Date(s.createdAt).getTime();
        if (d < new Date(filterFrom).getTime()) return false;
      }
      if (filterTo) {
        const d = typeof s.createdAt === 'number' ? s.createdAt * 1000 : new Date(s.createdAt).getTime();
        if (d > new Date(filterTo + 'T23:59:59').getTime()) return false;
      }
      return true;
    });
  }, [rows, search, filterFrom, filterTo]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const allOnPageSelected = paginated.length > 0 && paginated.every((s) => selected.has(s.id));
  const someSelected = selected.size > 0;

  const togglePageSelect = () => {
    if (allOnPageSelected) {
      setSelected((prev) => { const n = new Set(prev); paginated.forEach((s) => n.delete(s.id)); return n; });
    } else {
      setSelected((prev) => { const n = new Set(prev); paginated.forEach((s) => n.add(s.id)); return n; });
    }
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadCsv({ from: filterFrom || undefined, to: filterTo || undefined });
    } catch {
      setExportError('Export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => { setSearch(''); setFilterFrom(''); setFilterTo(''); setPage(1); };

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Submissions</h2>
          <p className="text-sm text-gray-500 mt-1">Leads captured by your estimator widgets</p>
        </div>
        <div className="flex items-center gap-2">
          {exportError && <span className="text-xs text-red-600">{exportError}</span>}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {exporting ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Email, zip, or name…"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {(search || filterFrom || filterTo) && (
          <button onClick={resetFilters} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            Clear
          </button>
        )}
        <div className="ml-auto text-xs text-gray-400 self-center">
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Bulk delete bar */}
      {someSelected && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-2.5 mb-3 flex items-center gap-3">
          <span className="text-sm font-medium text-brand-800">{selected.size} selected</span>
          {confirmBulk ? (
            <>
              <span className="text-sm text-red-700">Delete {selected.size} submission{selected.size !== 1 ? 's' : ''}?</span>
              <button
                onClick={() => bulkDeleteMutation.mutate([...selected])}
                disabled={bulkDeleteMutation.isPending}
                className="px-3 py-1 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {bulkDeleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button onClick={() => setConfirmBulk(false)} className="text-xs text-gray-600 hover:text-gray-800">Cancel</button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmBulk(true)}
                className="px-3 py-1 text-xs font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
              >
                Delete selected
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-700">Deselect all</button>
            </>
          )}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <p className="text-gray-900 font-medium mb-1">No submissions yet</p>
          <p className="text-sm text-gray-500">Share your estimator widget to start capturing leads.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-gray-500 text-sm">No submissions match your filters.</p>
          <button onClick={resetFilters} className="mt-2 text-sm text-brand-600 hover:text-brand-700">Clear filters</button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="pl-4 pr-2 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={togglePageSelect}
                    className="accent-brand-600 cursor-pointer"
                    aria-label="Select all on page"
                  />
                </th>
                <th className="px-3 py-3 font-medium text-gray-600">Date</th>
                <th className="px-3 py-3 font-medium text-gray-600">Email</th>
                <th className="px-3 py-3 font-medium text-gray-600">Name</th>
                <th className="px-3 py-3 font-medium text-gray-600">Phone</th>
                <th className="px-3 py-3 font-medium text-gray-600">Zip</th>
                <th className="px-3 py-3 font-medium text-gray-600">Estimate</th>
                <th className="px-3 py-3 font-medium text-gray-600">Area</th>
                <th className="px-3 py-3 font-medium text-gray-600 w-20" />
              </tr>
            </thead>
            <tbody>
              {paginated.map((s) => (
                <>
                  <tr
                    key={s.id}
                    className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${selected.has(s.id) ? 'bg-brand-50' : ''}`}
                    onClick={() => toggleExpand(s.id)}
                  >
                    <td className="pl-4 pr-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggleRow(s.id)}
                        className="accent-brand-600 cursor-pointer"
                        aria-label={`Select submission from ${s.leadEmail}`}
                      />
                    </td>
                    <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{fmtDate(s.createdAt)}</td>
                    <td className="px-3 py-3 text-gray-900 font-medium">{s.leadEmail}</td>
                    <td className="px-3 py-3 text-gray-600">{s.leadName ?? '—'}</td>
                    <td className="px-3 py-3 text-gray-600">{s.leadPhone ?? '—'}</td>
                    <td className="px-3 py-3 text-gray-600">{s.leadZip}</td>
                    <td className="px-3 py-3 text-gray-900 whitespace-nowrap">
                      {fmt(s.estimateMin)} – {fmt(s.estimateMax)}
                    </td>
                    <td className="px-3 py-3">
                      {s.serviceAreaValid ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs bg-green-50 text-green-700 border border-green-200">✓ Served</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs bg-red-50 text-red-600 border border-red-200">✗ Out</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {confirmDelete === s.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => deleteMutation.mutate(s.id)}
                            disabled={deleteMutation.isPending}
                            className="text-xs font-medium text-white bg-red-600 px-2 py-0.5 rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                          >
                            {deleteMutation.isPending ? '…' : 'Yes'}
                          </button>
                          <button onClick={() => setConfirmDelete(null)} className="text-xs text-gray-500 hover:text-gray-700">No</button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(s.id)}
                          className="text-xs text-red-500 hover:text-red-700 transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded.has(s.id) && (
                    <tr key={`${s.id}-expanded`} className="bg-gray-50 border-b border-gray-100">
                      <td colSpan={9} className="px-8 py-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Answers</p>
                        <AnswersRow answers={s.answers} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-500">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-white disabled:opacity-40 transition-colors"
                >
                  ← Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .reduce<(number | '…')[]>((acc, p, i, arr) => {
                    if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('…');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === '…' ? (
                      <span key={`ellipsis-${i}`} className="px-1 text-xs text-gray-400">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={`px-2.5 py-1 text-xs border rounded-md transition-colors ${
                          page === p
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'border-gray-300 text-gray-600 hover:bg-white'
                        }`}
                      >
                        {p}
                      </button>
                    ),
                  )}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-white disabled:opacity-40 transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
