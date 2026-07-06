import { eq, and, count } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { serviceAreas } from '../models/schema';
import type * as schema from '../models/schema';
import type { Result } from '@repo/shared';
import { ok, err } from '@repo/shared';

export class ServiceAreaService {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  /**
   * Check if a zip code is within a tenant's service area.
   *
   * Semantics:
   *   - If the tenant has NO configured zips → all zips are served (unconstrained).
   *   - If the tenant HAS configured zips → only listed zips are served.
   */
  async isZipServed(tenantId: string, zip: string): Promise<boolean> {
    const [row] = await this.db
      .select({ total: count() })
      .from(serviceAreas)
      .where(eq(serviceAreas.tenantId, tenantId));
    const total = row?.total ?? 0;

    if (total === 0) return true; // unconfigured → open to all

    const [match] = await this.db
      .select()
      .from(serviceAreas)
      .where(and(eq(serviceAreas.tenantId, tenantId), eq(serviceAreas.zip, zip.trim())))
      .limit(1);

    return !!match;
  }

  /**
   * Import zip codes from an array (parsed from CSV).
   * Replaces any existing service area for the tenant.
   */
  async importZips(
    tenantId: string,
    zips: string[],
  ): Promise<Result<{ imported: number }, { code: string; message: string }>> {
    const trimmed = zips.map((z) => z.trim()).filter(Boolean);
    if (trimmed.length === 0) {
      return err({ code: 'EMPTY_IMPORT', message: 'No zip codes provided.' });
    }

    await this.db.delete(serviceAreas).where(eq(serviceAreas.tenantId, tenantId));
    await this.db.insert(serviceAreas).values(trimmed.map((zip) => ({ tenantId, zip })));

    return ok({ imported: trimmed.length });
  }

  /**
   * Remove all configured zips for a tenant (reverts to "open to all").
   */
  async clearZips(tenantId: string): Promise<void> {
    await this.db.delete(serviceAreas).where(eq(serviceAreas.tenantId, tenantId));
  }

  /**
   * List all configured zips for a tenant.
   */
  async listZips(tenantId: string): Promise<string[]> {
    const rows = await this.db
      .select({ zip: serviceAreas.zip })
      .from(serviceAreas)
      .where(eq(serviceAreas.tenantId, tenantId));
    return rows.map((r) => r.zip);
  }
}
