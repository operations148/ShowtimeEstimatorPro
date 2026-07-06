import { sql, count, eq, and, gte, lte, isNotNull, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { analyticsEvents, submissions } from '../models/schema';
import type * as schema from '../models/schema';
import type { AnalyticsSummary } from '@repo/shared';

export interface SummaryOpts {
  estimatorId?: string;
  from?: Date;
  to?: Date;
}

export class AnalyticsService {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  /**
   * Record an analytics event. Fire-and-forget callers can ignore the promise
   * (attach a .catch to avoid unhandled rejections).
   */
  async track(event: {
    tenantId: string;
    estimatorId: string;
    eventType: string;
    stepId?: string;
    sessionId: string;
  }): Promise<void> {
    await this.db.insert(analyticsEvents).values(event);
  }

  /**
   * Compute aggregate analytics using SQL for a tenant, optionally filtered by
   * estimator and/or date range. All queries are tenant-scoped.
   */
  async getSummary(tenantId: string, opts?: SummaryOpts): Promise<AnalyticsSummary> {
    const subConds = this.subConditions(tenantId, opts);
    const evtConds = this.evtConditions(tenantId, opts);

    // ── 1. Totals ─────────────────────────────────────────────────────────────
    const [totals] = await this.db
      .select({
        total: count(),
        totalRevenue: sql<number>`COALESCE(SUM((${submissions.estimateMin} + ${submissions.estimateMax}) / 2), 0)`,
        avgEstimate: sql<number>`COALESCE(CAST(AVG((${submissions.estimateMin} + ${submissions.estimateMax}) / 2) AS INTEGER), 0)`,
      })
      .from(submissions)
      .where(and(...subConds));

    const totalSubmissions = totals?.total ?? 0;
    const totalEstimatedRevenue = Number(totals?.totalRevenue ?? 0);
    const averageEstimate = Number(totals?.avgEstimate ?? 0);

    // ── 2. Time series — GROUP BY calendar date ───────────────────────────────
    const dateExpr = sql<string>`to_char(${submissions.createdAt}, 'YYYY-MM-DD')`;

    const timeSeriesRows = await this.db
      .select({
        date: dateExpr,
        count: count(),
        revenue: sql<number>`COALESCE(SUM((${submissions.estimateMin} + ${submissions.estimateMax}) / 2), 0)`,
      })
      .from(submissions)
      .where(and(...subConds))
      .groupBy(dateExpr)
      .orderBy(dateExpr);

    const submissionsOverTime = timeSeriesRows.map((r) => ({ date: r.date, count: Number(r.count) }));
    const revenueOverTime = timeSeriesRows.map((r) => ({ date: r.date, revenue: Number(r.revenue) }));

    // ── 3. Drop-off by step ──────────────────────────────────────────────────
    const stepConds: SQL<unknown>[] = [
      ...evtConds,
      isNotNull(analyticsEvents.stepId),
      inArray(analyticsEvents.eventType, ['step_view', 'step_complete']),
    ];

    const dropOffRows = await this.db
      .select({
        stepId: analyticsEvents.stepId,
        views: sql<number>`COUNT(CASE WHEN ${analyticsEvents.eventType} = 'step_view' THEN 1 END)`,
        completions: sql<number>`COUNT(CASE WHEN ${analyticsEvents.eventType} = 'step_complete' THEN 1 END)`,
      })
      .from(analyticsEvents)
      .where(and(...stepConds))
      .groupBy(analyticsEvents.stepId)
      .orderBy(analyticsEvents.stepId);

    const dropOffByStep = dropOffRows
      .filter((r) => r.stepId !== null)
      .map((r) => {
        const views = Number(r.views);
        const completions = Number(r.completions);
        const dropOffRate = views > 0 ? Math.round(((views - completions) / views) * 100) / 100 : 0;
        return { stepId: r.stepId as string, views, completions, dropOffRate };
      });

    return {
      totalSubmissions: Number(totalSubmissions),
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
