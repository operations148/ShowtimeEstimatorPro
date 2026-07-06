import { sql, count, eq, and, gte, lte, isNotNull, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { analyticsEvents, submissions } from '../models/schema';
import type * as schema from '../models/schema';
import type { AnalyticsSummary } from '@repo/shared';

export interface SummaryOpts {
  estimatorId?: string;
  from?: Date;
  to?: Date;
}

export class AnalyticsService {
  constructor(private db: BetterSQLite3Database<typeof schema>) {}

  /**
   * Record an analytics event (synchronous — fire-and-forget callers can ignore the return).
   */
  track(event: {
    tenantId: string;
    estimatorId: string;
    eventType: string;
    stepId?: string;
    sessionId: string;
  }): void {
    this.db.insert(analyticsEvents).values(event).run();
  }

  /**
   * Compute aggregate analytics using SQL for a tenant, optionally filtered by
   * estimator and/or date range. All queries are tenant-scoped.
   */
  getSummary(tenantId: string, opts?: SummaryOpts): AnalyticsSummary {
    const subConds = this.subConditions(tenantId, opts);
    const evtConds = this.evtConditions(tenantId, opts);

    // ── 1. Totals ─────────────────────────────────────────────────────────────
    const [totals] = this.db
      .select({
        total: count(),
        totalRevenue: sql<number>`COALESCE(SUM((${submissions.estimateMin} + ${submissions.estimateMax}) / 2), 0)`,
        avgEstimate: sql<number>`COALESCE(CAST(AVG((${submissions.estimateMin} + ${submissions.estimateMax}) / 2) AS INTEGER), 0)`,
      })
      .from(submissions)
      .where(and(...subConds))
      .all();

    const totalSubmissions = totals?.total ?? 0;
    const totalEstimatedRevenue = totals?.totalRevenue ?? 0;
    const averageEstimate = totals?.avgEstimate ?? 0;

    // ── 2. Time series — GROUP BY calendar date ───────────────────────────────
    // created_at is stored as Unix seconds (integer mode:'timestamp')
    const dateExpr = sql<string>`strftime('%Y-%m-%d', datetime(${submissions.createdAt}, 'unixepoch'))`;

    const timeSeriesRows = this.db
      .select({
        date: dateExpr,
        count: count(),
        revenue: sql<number>`COALESCE(SUM((${submissions.estimateMin} + ${submissions.estimateMax}) / 2), 0)`,
      })
      .from(submissions)
      .where(and(...subConds))
      .groupBy(dateExpr)
      .orderBy(dateExpr)
      .all();

    const submissionsOverTime = timeSeriesRows.map((r) => ({
      date: r.date,
      count: r.count,
    }));

    const revenueOverTime = timeSeriesRows.map((r) => ({
      date: r.date,
      revenue: r.revenue,
    }));

    // ── 3. Drop-off by step ──────────────────────────────────────────────────
    // Conditional COUNT so a single pass over analytics_events yields both
    // step_view and step_complete counts per stepId.
    const stepConds: SQL<unknown>[] = [
      ...evtConds,
      isNotNull(analyticsEvents.stepId),
      inArray(analyticsEvents.eventType, ['step_view', 'step_complete']),
    ];

    const dropOffRows = this.db
      .select({
        stepId: analyticsEvents.stepId,
        views: sql<number>`COUNT(CASE WHEN ${analyticsEvents.eventType} = 'step_view' THEN 1 END)`,
        completions: sql<number>`COUNT(CASE WHEN ${analyticsEvents.eventType} = 'step_complete' THEN 1 END)`,
      })
      .from(analyticsEvents)
      .where(and(...stepConds))
      .groupBy(analyticsEvents.stepId)
      .orderBy(analyticsEvents.stepId)
      .all();

    const dropOffByStep = dropOffRows
      .filter((r) => r.stepId !== null)
      .map((r) => {
        const views = r.views;
        const completions = r.completions;
        const dropOffRate = views > 0 ? Math.round(((views - completions) / views) * 100) / 100 : 0;
        return { stepId: r.stepId as string, views, completions, dropOffRate };
      });

    return {
      totalSubmissions,
      totalEstimatedRevenue,
      averageEstimate,
      submissionsOverTime,
      revenueOverTime,
      dropOffByStep,
    };
  }

  // ── Condition builders ───────────────────────────────────────────────────────

  private subConditions(tenantId: string, opts?: SummaryOpts): SQL<unknown>[] {
    const conds: SQL<unknown>[] = [eq(submissions.tenantId, tenantId)];
    if (opts?.estimatorId) conds.push(eq(submissions.estimatorId, opts.estimatorId));
    if (opts?.from) conds.push(gte(submissions.createdAt, opts.from));
    if (opts?.to) conds.push(lte(submissions.createdAt, opts.to));
    return conds;
  }

  private evtConditions(tenantId: string, opts?: SummaryOpts): SQL<unknown>[] {
    const conds: SQL<unknown>[] = [eq(analyticsEvents.tenantId, tenantId)];
    if (opts?.estimatorId) conds.push(eq(analyticsEvents.estimatorId, opts.estimatorId));
    if (opts?.from) conds.push(gte(analyticsEvents.createdAt, opts.from));
    if (opts?.to) conds.push(lte(analyticsEvents.createdAt, opts.to));
    return conds;
  }
}
