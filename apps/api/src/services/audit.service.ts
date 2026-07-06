import { eq, and, gte, lte, count, desc } from 'drizzle-orm';
import { logger } from '../lib/logger';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { auditLogs } from '../models/schema';
import type * as schema from '../models/schema';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from '@repo/shared';

export interface LogActionParams {
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface QueryLogsFilters {
  actorId?: string;
  action?: string;
  resourceType?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: Date;
}

export interface QueryLogsResult {
  logs: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export class AuditService {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  /**
   * Append a single audit log entry. Fire-and-forget safe: never rejects —
   * errors are swallowed so they can't disrupt the caller's request flow.
   */
  async logAction(params: LogActionParams): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        tenantId: params.tenantId,
        actorId: params.actorId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      });
    } catch (err) {
      logger.error({ err }, 'AuditService: failed to write log entry');
    }
  }

  /**
   * Query audit logs for a tenant with optional filters and pagination.
   * Always tenant-scoped — callers cannot access another tenant's logs.
   */
  async queryLogs(tenantId: string, filters: QueryLogsFilters = {}): Promise<QueryLogsResult> {
    const limit = Math.min(filters.limit ?? PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT);
    const offset = filters.offset ?? 0;

    const conds: SQL<unknown>[] = [eq(auditLogs.tenantId, tenantId)];
    if (filters.actorId) conds.push(eq(auditLogs.actorId, filters.actorId));
    if (filters.action) conds.push(eq(auditLogs.action, filters.action));
    if (filters.resourceType) conds.push(eq(auditLogs.resourceType, filters.resourceType));
    if (filters.from) conds.push(gte(auditLogs.timestamp, filters.from));
    if (filters.to) conds.push(lte(auditLogs.timestamp, filters.to));

    const where = and(...conds);

    const [countRow] = await this.db.select({ total: count() }).from(auditLogs).where(where);
    const total = Number(countRow?.total ?? 0);

    const logs = (await this.db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit)
      .offset(offset)) as AuditLogEntry[];

    return { logs, total, limit, offset };
  }
}
