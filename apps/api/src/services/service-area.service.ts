import { eq, and, count } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { serviceAreas } from '../models/schema';
import type * as schema from '../models/schema';
import type { Result } from '@repo/shared';
import { ok, err } from '@repo/shared';

export class ServiceAreaService {
  constructor(private db: BetterSQLite3Database<typeof schema>) {}

  /**
   * Check if a zip code is within a tenant's service area.
   *
   * Semantics:
   *   - If the tenant has NO configured zips → all zips are served (unconstrained).
   *   - If the tenant HAS configured zips → only listed zips are served.
   */
  isZipServed(tenantId: string, zip: string): boolean {
    // Count total zips for this tenant
    const [row] = this.db
      .select({ total: count() })
      .from(serviceAreas)
      .where(eq(serviceAreas.tenantId, tenantId))
      .all();
    const total = row?.total ?? 0;

    if (total === 0) return true; // unconfigured → open to all

    const [match] = this.db
      .select()
      .from(serviceAreas)
      .where(and(eq(serviceAreas.tenantId, tenantId), eq(serviceAreas.zip, zip.trim())))
      .limit(1)
      .all();

    return !!match;
  }

  /**
   * Import zip codes from an array (parsed from CSV).
   * Replaces any existing service area for the tenant.
   */
  importZips(
    tenantId: string,
    zips: string[],
  ): Result<{ imported: number }, { code: string; message: string }> {
    const trimmed = zips.map((z) => z.trim()).filter(Boolean);
    if (trimmed.length === 0) {
      return err({ code: 'EMPTY_IMPORT', message: 'No zip codes provided.' });
    }

    this.db.delete(serviceAreas).where(eq(serviceAreas.tenantId, tenantId)).run();
    this.db
      .insert(serviceAreas)
      .values(trimmed.map((zip) => ({ tenantId, zip })))
      .run();

    return ok({ imported: trimmed.length });
  }

  /**
   * Remove all configured zips for a tenant (reverts to "open to all").
   */
  clearZips(tenantId: string): void {
    this.db.delete(serviceAreas).where(eq(serviceAreas.tenantId, tenantId)).run();
  }

  /**
   * List all configured zips for a tenant.
   */
  listZips(tenantId: string): string[] {
    return this.db
      .select({ zip: serviceAreas.zip })
      .from(serviceAreas)
      .where(eq(serviceAreas.tenantId, tenantId))
      .all()
      .map((r) => r.zip);
  }
}
