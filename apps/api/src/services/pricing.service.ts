import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { pricingConfigs } from '../models/schema';
import type * as schema from '../models/schema';
import { computeEstimate } from '@repo/pricing-engine';
import type { PricingConfig, PricingInput, PricingResult } from '@repo/shared';
import type { Result } from '@repo/shared';
import { ok, err } from '@repo/shared';
import { pricingConfigSchema } from '@repo/shared';

export class PricingService {
  constructor(private db: BetterSQLite3Database<typeof schema>) {}

  /**
   * Load a tenant's pricing config and compute an estimate.
   */
  async compute(
    tenantId: string,
    estimatorId: string,
    input: PricingInput,
  ): Promise<Result<PricingResult, { code: string; message: string }>> {
    const [configRow] = this.db
      .select()
      .from(pricingConfigs)
      .where(
        and(eq(pricingConfigs.tenantId, tenantId), eq(pricingConfigs.estimatorId, estimatorId)),
      )
      .limit(1)
      .all();

    if (!configRow) {
      return err({ code: 'NO_PRICING_CONFIG', message: 'No pricing configuration found.' });
    }

    const parseResult = pricingConfigSchema.safeParse(configRow.config);
    if (!parseResult.success) {
      return err({ code: 'INVALID_CONFIG', message: 'Pricing configuration is malformed.' });
    }

    const result = computeEstimate(parseResult.data, input);
    return ok(result);
  }

  /**
   * Get the current pricing config for a tenant + estimator.
   */
  getConfig(
    tenantId: string,
    estimatorId: string,
  ): Result<PricingConfig, { code: string; message: string }> {
    const [configRow] = this.db
      .select()
      .from(pricingConfigs)
      .where(
        and(eq(pricingConfigs.tenantId, tenantId), eq(pricingConfigs.estimatorId, estimatorId)),
      )
      .limit(1)
      .all();

    if (!configRow) {
      return err({ code: 'NO_PRICING_CONFIG', message: 'No pricing configuration found.' });
    }

    const parseResult = pricingConfigSchema.safeParse(configRow.config);
    if (!parseResult.success) {
      return err({ code: 'INVALID_CONFIG', message: 'Pricing configuration is malformed.' });
    }

    return ok(parseResult.data);
  }

  /**
   * Save or update a pricing config for a tenant + estimator.
   */
  async upsert(
    tenantId: string,
    estimatorId: string,
    config: PricingConfig,
  ): Promise<Result<{ id: string }, { code: string; message: string }>> {
    const [existing] = this.db
      .select()
      .from(pricingConfigs)
      .where(
        and(eq(pricingConfigs.tenantId, tenantId), eq(pricingConfigs.estimatorId, estimatorId)),
      )
      .limit(1)
      .all();

    if (existing) {
      this.db
        .update(pricingConfigs)
        .set({ config, updatedAt: new Date() })
        .where(eq(pricingConfigs.id, existing.id))
        .run();
      return ok({ id: existing.id });
    }

    const [inserted] = this.db
      .insert(pricingConfigs)
      .values({ tenantId, estimatorId, config })
      .returning()
      .all();

    return ok({ id: inserted!.id });
  }
}
