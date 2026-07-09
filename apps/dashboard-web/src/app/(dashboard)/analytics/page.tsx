'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { api } from '@/lib/api';
import type { AnalyticsSummary, Estimator } from '@repo/shared';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DateRange {
  from: string; // ISO date string YYYY-MM-DD
  to: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toISODate(d: Date) {
  // Use LOCAL date parts, not UTC (toISOString). The range strings are later read
  // back as local time (new Date(str + 'T23:59:59')), so a UTC date here would push
  // the window's end into the past for timezones ahead of UTC — silently excluding
  // submissions made later in the local day.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
}

function today() {
  return toISODate(new Date());
}

function fmtMoney(amount: number) {
  return '$' + amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Preset buttons ────────────────────────────────────────────────────────────

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

// ── Skeleton ──────────────────────────────────────────────────────────────────

function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div style={{ background: '#1e3048', borderRadius: 8, width: '100%', height, opacity: 0.6 }} />
  );
}

function StatSkeleton() {
  return (
    <div style={{ background: '#111d2e', border: '1px solid #1e3048', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ height: 12, background: '#1e3048', borderRadius: 6, width: '40%', marginBottom: 12 }} />
      <div style={{ height: 28, background: '#1e3048', borderRadius: 6, width: '60%' }} />
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: '#111d2e', border: '1px solid #1e3048', borderRadius: 12, padding: '20px 24px' }}>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, color: '#00cfff', letterSpacing: '-0.02em' }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

// ── Empty chart state ─────────────────────────────────────────────────────────

function ChartEmpty({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 220, borderRadius: 8, border: '1px dashed #1e3048' }}>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>{message}</p>
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1a2f48', border: '1px solid #2a4060', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{label ? fmtDate(label) : ''}</p>
      <p style={{ color: '#00cfff', fontWeight: 700 }}>{fmtMoney(payload[0]?.value ?? 0)}</p>
    </div>
  );
}

function SubmissionsTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1a2f48', border: '1px solid #2a4060', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{label ? fmtDate(label) : ''}</p>
      <p style={{ color: '#00cfff', fontWeight: 700 }}>{payload[0]?.value} submission{payload[0]?.value !== 1 ? 's' : ''}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [preset, setPreset] = useState<7 | 30 | 90 | null>(30);
  const [customRange, setCustomRange] = useState<DateRange>({ from: daysAgo(30), to: today() });
  const [estimatorId, setEstimatorId] = useState<string>('');

  const range: DateRange = useMemo(() => {
    if (preset !== null) return { from: daysAgo(preset), to: today() };
    return customRange;
  }, [preset, customRange]);

  // Fetch estimator list for the filter dropdown
  const { data: estimators = [] } = useQuery({
    queryKey: ['estimators'],
    queryFn: () => api.get<Estimator[]>('/estimators').then((r) => r.data ?? []),
  });

  // Fetch analytics summary — cache key includes all filters
  const { data: summary, isLoading } = useQuery({
    queryKey: ['analytics', 'summary', range.from, range.to, estimatorId],
    queryFn: () => {
      const qs = new URLSearchParams({
        from: new Date(range.from + 'T00:00:00').toISOString(),
        to: new Date(range.to + 'T23:59:59').toISOString(),
        ...(estimatorId ? { estimatorId } : {}),
      });
      return api.get<AnalyticsSummary>(`/analytics/summary?${qs}`).then((r) => r.data ?? null);
    },
  });

  const revenueData = summary?.revenueOverTime ?? [];
  const submissionsData = summary?.submissionsOverTime ?? [];
  const dropOffData = summary?.dropOffByStep ?? [];

  return (
    <>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Analytics</h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Performance metrics across your estimators</p>
      </div>

      {/* Filters */}
      <div style={{ background: '#111d2e', border: '1px solid #1e3048', borderRadius: 12, padding: '16px 20px', marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        {/* Preset buttons */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date range</p>
          <div style={{ display: 'flex', gap: 4 }}>
            {PRESETS.map((p) => (
              <button
                key={p.days}
                onClick={() => setPreset(p.days)}
                style={{
                  padding: '6px 12px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: 'none',
                  background: preset === p.days ? 'linear-gradient(90deg,#00cfff,#0080ff)' : '#1a2f48',
                  color: preset === p.days ? '#0a1628' : 'rgba(255,255,255,0.6)',
                }}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setPreset(null)}
              style={{
                padding: '6px 12px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: 'none',
                background: preset === null ? 'linear-gradient(90deg,#00cfff,#0080ff)' : '#1a2f48',
                color: preset === null ? '#0a1628' : 'rgba(255,255,255,0.6)',
              }}
            >
              Custom
            </button>
          </div>
        </div>

        {/* Custom date inputs — only visible when preset = null */}
        {preset === null && (
          <>
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>From</p>
              <input
                type="date"
                value={customRange.from}
                max={customRange.to}
                onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))}
                style={{ background: '#1a2f48', border: '1px solid #2a4060', borderRadius: 8, padding: '6px 10px', fontSize: 13, color: '#fff', outline: 'none' }}
              />
            </div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>To</p>
              <input
                type="date"
                value={customRange.to}
                min={customRange.from}
                max={today()}
                onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))}
                style={{ background: '#1a2f48', border: '1px solid #2a4060', borderRadius: 8, padding: '6px 10px', fontSize: 13, color: '#fff', outline: 'none' }}
              />
            </div>
          </>
        )}

        {/* Estimator filter */}
        <div style={{ marginLeft: 'auto' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estimator</p>
          <select
            value={estimatorId}
            onChange={(e) => setEstimatorId(e.target.value)}
            style={{ background: '#1a2f48', border: '1px solid #2a4060', borderRadius: 8, padding: '6px 10px', fontSize: 13, color: '#fff', outline: 'none' }}
          >
            <option value="">All estimators</option>
            {estimators.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        {isLoading ? (
          [0, 1, 2].map((i) => <StatSkeleton key={i} />)
        ) : !summary ? (
          [
            { label: 'Total Submissions', value: '—' },
            { label: 'Estimated Revenue', value: '—' },
            { label: 'Average Estimate', value: '—' },
          ].map((s) => <StatCard key={s.label} label={s.label} value={s.value} />)
        ) : (
          <>
            <StatCard
              label="Total Submissions"
              value={summary.totalSubmissions.toLocaleString()}
              sub={`${range.from} – ${range.to}`}
            />
            <StatCard
              label="Estimated Revenue"
              value={fmtMoney(summary.totalEstimatedRevenue)}
            />
            <StatCard
              label="Average Estimate"
              value={fmtMoney(summary.averageEstimate)}
            />
          </>
        )}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 16 }}>
        {/* Revenue over time */}
        <div style={{ background: '#111d2e', border: '1px solid #1e3048', borderRadius: 12, padding: '20px 24px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 16 }}>Revenue Over Time</h3>
          {isLoading ? (
            <ChartSkeleton />
          ) : revenueData.length === 0 ? (
            <ChartEmpty message="No revenue data for this period" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={revenueData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="barGradA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00cfff" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#0080ff" stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.3)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={(v) => '$' + Number(v / 1000).toFixed(0) + 'k'} tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.3)' }} tickLine={false} axisLine={false} width={44} />
                <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="revenue" fill="url(#barGradA)" radius={[3, 3, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Submissions over time */}
        <div style={{ background: '#111d2e', border: '1px solid #1e3048', borderRadius: 12, padding: '20px 24px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 16 }}>Submissions Over Time</h3>
          {isLoading ? (
            <ChartSkeleton />
          ) : submissionsData.length === 0 ? (
            <ChartEmpty message="No submission data for this period" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={submissionsData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.3)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.3)' }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <Tooltip content={<SubmissionsTooltip />} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#00cfff"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#00cfff', strokeWidth: 0 }}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Drop-off by step */}
      <div style={{ background: '#111d2e', border: '1px solid #1e3048', borderRadius: 12, padding: '20px 24px' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 16 }}>Drop-off Per Step</h3>
        {isLoading ? (
          <ChartSkeleton height={140} />
        ) : dropOffData.length === 0 ? (
          <ChartEmpty message="No step data for this period" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e3048', textAlign: 'left' }}>
                  {['Step', 'Views', 'Completions', 'Drop-off', 'Completion rate'].map((h, i) => (
                    <th key={h} style={{ paddingBottom: 10, paddingRight: i < 4 ? 24 : 0, fontWeight: 600, fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: i >= 1 && i <= 3 ? 'right' : 'left' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dropOffData.map((row) => {
                  const completionRate = 1 - row.dropOffRate;
                  return (
                    <tr key={row.stepId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '12px 24px 12px 0', fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{row.stepId}</td>
                      <td style={{ padding: '12px 24px 12px 0', textAlign: 'right', color: '#fff' }}>{row.views.toLocaleString()}</td>
                      <td style={{ padding: '12px 24px 12px 0', textAlign: 'right', color: '#fff' }}>{row.completions.toLocaleString()}</td>
                      <td style={{ padding: '12px 24px 12px 0', textAlign: 'right' }}>
                        <span style={{ fontWeight: 600, color: row.dropOffRate > 0.5 ? '#ff6b6b' : row.dropOffRate > 0.2 ? '#fbbf24' : '#4ade80' }}>
                          {(row.dropOffRate * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td style={{ padding: '12px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: '#1e3048', borderRadius: 3, overflow: 'hidden', minWidth: 80 }}>
                            <div style={{ height: '100%', borderRadius: 3, background: 'linear-gradient(90deg,#00cfff,#0080ff)', width: `${completionRate * 100}%` }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', width: 36, textAlign: 'right' }}>
                            {(completionRate * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
