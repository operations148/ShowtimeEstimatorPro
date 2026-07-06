'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import { api } from '@/lib/api';
import type { AnalyticsSummary } from '@repo/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(amount: number) {
  return '$' + amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Tooltip components ────────────────────────────────────────────────────────

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

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, delta,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: string;
}) {
  return (
    <div
      style={{
        background: '#111d2e',
        border: '1px solid #1e3048',
        borderRadius: 12,
        padding: '20px 24px',
      }}
    >
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </p>
      <p style={{ fontSize: 28, fontWeight: 800, color: '#00cfff', letterSpacing: '-0.02em', marginBottom: 6 }}>
        {value}
      </p>
      {(sub ?? delta) && (
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>
          {delta && <span style={{ color: '#4ade80', marginRight: 4 }}>{delta}</span>}
          {sub}
        </p>
      )}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div style={{ background: '#111d2e', border: '1px solid #1e3048', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ height: 12, background: '#1e3048', borderRadius: 6, width: '40%', marginBottom: 12 }} />
      <div style={{ height: 28, background: '#1e3048', borderRadius: 6, width: '60%' }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: summary, isLoading } = useQuery({
    queryKey: ['analytics', 'summary', daysAgo(30), today()],
    queryFn: () => {
      const qs = new URLSearchParams({
        from: new Date(daysAgo(30) + 'T00:00:00').toISOString(),
        to: new Date(today() + 'T23:59:59').toISOString(),
      });
      return api.get<AnalyticsSummary>(`/analytics/summary?${qs}`).then((r) => r.data ?? null);
    },
  });

  const revenueData = summary?.revenueOverTime ?? [];
  const submissionsData = summary?.submissionsOverTime ?? [];
  const totalRevenue = summary?.totalEstimatedRevenue ?? 0;
  const totalSubs = summary?.totalSubmissions ?? 0;
  const avgEst = summary?.averageEstimate ?? 0;

  const axisStyle = { fontSize: 11, fill: 'rgba(255,255,255,0.3)' };

  return (
    <>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Dashboard</h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Welcome back — here&apos;s what&apos;s happening</p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {isLoading ? (
          [0, 1, 2].map((i) => <CardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              label="Total Estimated Revenue"
              value={fmtMoney(totalRevenue)}
              sub="cumulative submitted estimates"
            />
            <StatCard
              label="Estimator Submissions"
              value={totalSubs.toLocaleString()}
              sub="leads captured via widget"
            />
            <StatCard
              label="Avg Estimate Value"
              value={fmtMoney(avgEst)}
              sub="average per submission"
            />
          </>
        )}
      </div>

      {/* Revenue Over Time bar chart */}
      <div
        style={{
          background: '#111d2e',
          border: '1px solid #1e3048',
          borderRadius: 12,
          padding: '20px 24px',
          marginBottom: 16,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Estimated Revenue Over Time
          </p>
          <p style={{ fontSize: 22, fontWeight: 800, color: '#00cfff', letterSpacing: '-0.02em' }}>
            {fmtMoney(totalRevenue)}
          </p>
        </div>
        {revenueData.length === 0 ? (
          <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>No revenue data yet — publish an estimator to start capturing leads</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={revenueData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00cfff" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#0080ff" stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={(v) => '$' + Number(v / 1000).toFixed(0) + 'k'} tick={axisStyle} tickLine={false} axisLine={false} width={44} />
              <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="revenue" fill="url(#barGrad)" radius={[3, 3, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Submissions area chart */}
      <div
        style={{
          background: '#111d2e',
          border: '1px solid #1e3048',
          borderRadius: 12,
          padding: '20px 24px',
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Estimator Submissions
          </p>
          <p style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
            {totalSubs.toLocaleString()}
          </p>
        </div>
        {submissionsData.length === 0 ? (
          <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>No submission data for this period</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={submissionsData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00cfff" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#00cfff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
              <Tooltip content={<SubmissionsTooltip />} />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#00cfff"
                strokeWidth={2}
                fill="url(#areaGrad)"
                dot={{ r: 3, fill: '#00cfff', strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
}
