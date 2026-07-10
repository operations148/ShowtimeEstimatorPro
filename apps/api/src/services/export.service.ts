import { eq, and, gte, lte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { submissions } from '../models/schema';
import type * as schema from '../models/schema';
import { CSV_EXPORT_MAX_ROWS } from '@repo/shared';
import type { Result } from '@repo/shared';
import { ok, err } from '@repo/shared';

export interface ExportOpts {
  estimatorId?: string;
  from?: Date;
  to?: Date;
}

export class ExportService {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  /**
   * Generate a CSV string from submissions for a given tenant.
   *
   * - Filters by estimatorId and/or date range when provided.
   * - Flattens all answer keys as individual columns (answer_<key>).
   * - All string values are properly CSV-escaped.
   * - Enforces CSV_EXPORT_MAX_ROWS; returns an error result if exceeded.
   */
  async exportSubmissions(
    tenantId: string,
    opts?: ExportOpts,
  ): Promise<Result<string, { code: string; message: string }>> {
    const conds: SQL<unknown>[] = [eq(submissions.tenantId, tenantId)];
    if (opts?.estimatorId) conds.push(eq(submissions.estimatorId, opts.estimatorId));
    if (opts?.from) conds.push(gte(submissions.createdAt, opts.from));
    if (opts?.to) conds.push(lte(submissions.createdAt, opts.to));

    // Fetch one extra row so we can detect overflow without a separate COUNT query.
    const rows = await this.db
      .select()
      .from(submissions)
      .where(and(...conds))
      .orderBy(submissions.createdAt)
      .limit(CSV_EXPORT_MAX_ROWS + 1);

    if (rows.length > CSV_EXPORT_MAX_ROWS) {
      return err({
        code: 'EXPORT_TOO_LARGE',
        message: `Export exceeds the ${CSV_EXPORT_MAX_ROWS.toLocaleString()} row limit. Apply a narrower date range or estimator filter.`,
      });
    }

    // ── Collect all unique answer keys across every row ───────────────────────
    const answerKeySet = new Set<string>();
    for (const row of rows) {
      if (row.answers && typeof row.answers === 'object') {
        for (const key of Object.keys(row.answers)) {
          answerKeySet.add(key);
        }
      }
    }
    const answerKeys = [...answerKeySet].sort();

    // ── Headers ───────────────────────────────────────────────────────────────
    const baseHeaders = [
      'id',
      'estimator_id',
      'version_id',
      'lead_email',
      'lead_zip',
      'lead_name',
      'lead_phone',
      'estimate_min',
      'estimate_max',
      'currency',
      'service_area_valid',
      'created_at',
    ];
    const headers = [...baseHeaders, ...answerKeys.map((k) => `answer_${k}`)];

    // ── Rows ──────────────────────────────────────────────────────────────────
    const csvRows = rows.map((r) => {
      const base = [
        escapeCsv(r.id),
        escapeCsv(r.estimatorId),
        escapeCsv(r.versionId),
        escapeCsv(r.leadEmail),
        escapeCsv(r.leadZip ?? ''),
        escapeCsv(r.leadName ?? ''),
        escapeCsv(r.leadPhone ?? ''),
        String(r.estimateMin),
        String(r.estimateMax),
        escapeCsv(r.currency),
        r.serviceAreaValid ? 'true' : 'false',
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      ];

      const answerCells = answerKeys.map((k) => {
        const val = (r.answers as Record<string, unknown>)[k];
        if (val === undefined || val === null) return '';
        if (typeof val === 'string') return escapeCsv(val);
        return escapeCsv(JSON.stringify(val));
      });

      return [...base, ...answerCells].join(',');
    });

    return ok([headers.join(','), ...csvRows].join('\n'));
  }
}

/**
 * RFC 4180-compliant CSV field escaping.
 *
 * A field is quoted if it contains a comma, double-quote, carriage return,
 * or newline. Double-quotes within a field are escaped by doubling them.
 */
export function escapeCsv(value: string): string {
  // Neutralize spreadsheet formula injection: a cell beginning with = + - @ (or a
  // leading tab/CR) is executed as a formula by Excel / Google Sheets. A lead could
  // submit a name like `=HYPERLINK(...)` or a DDE payload. Prefix such values with a
  // single quote so the spreadsheet treats them as literal text.
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) {
    v = `'${v}`;
  }
  if (/[,"\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
