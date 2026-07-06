import { eq, and, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { submissions } from '../models/schema';
import type * as schema from '../models/schema';

/**
 * RetentionService — enforces tenant-configured data retention periods.
 *
 * ## Background job integration
 *
 * This service is intended to be called from a scheduled job that runs once per day.
 * The job should iterate over all tenants that have a `retentionDays` value set and
 * call `purgeExpired` for each one.
 *
 * ### Conceptual cron entrypoint (`apps/api/src/jobs/retention-purge.ts`):
 *
 * ```ts
 * import { db } from '../models/db';
 * import { tenants } from '../models/schema';
 * import { isNotNull } from 'drizzle-orm';
 * import { RetentionService } from '../services/retention.service';
 *
 * export async function runRetentionPurge(): Promise<void> {
 *   const tenantsWithRetention = db
 *     .select({ id: tenants.id, retentionDays: tenants.retentionDays })
 *     .from(tenants)
 *     .where(isNotNull(tenants.retentionDays))
 *     .all();
 *
 *   const retention = new RetentionService(db);
 *
 *   for (const tenant of tenantsWithRetention) {
 *     const deleted = retention.purgeExpired(tenant.id, tenant.retentionDays!);
 *     console.log(`[Retention] Purged ${deleted} submissions for tenant ${tenant.id}`);
 *   }
 * }
 * ```
 *
 * ### Scheduling options (choose one for your deployment):
 * - **Railway / Render cron**: Add a separate service with `node dist/jobs/retention-purge.js`
 *   on a `0 3 * * *` (3 AM UTC daily) schedule.
 * - **Vercel cron**: Add `{ "path": "/api/cron/retention", "schedule": "0 3 * * *" }` to
 *   `vercel.json` and expose a protected API route that calls `runRetentionPurge()`.
 * - **Self-hosted**: Use node-cron or a system cron (`crontab -e`) to invoke the job script.
 *
 * Secure the cron endpoint with a shared secret (`CRON_SECRET` env var) checked against
 * an `Authorization: Bearer <secret>` header to prevent unauthorized invocation.
 */
export class RetentionService {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  /**
   * Hard-delete all submissions for `tenantId` that are older than `retentionDays`.
   *
   * @param tenantId - The tenant whose submissions to purge.
   * @param retentionDays - Maximum age in days. Submissions older than this are deleted.
   * @returns Number of submission rows deleted.
   */
  async purgeExpired(tenantId: string, retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const deleted = await this.db
      .delete(submissions)
      .where(and(eq(submissions.tenantId, tenantId), lt(submissions.createdAt, cutoff)))
      .returning({ id: submissions.id });

    return deleted.length;
  }
}
