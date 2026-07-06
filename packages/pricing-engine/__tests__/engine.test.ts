import { describe, it, expect } from 'vitest';
import { computeEstimate } from '../src/engine';
import type { PricingConfig, PricingInput } from '@repo/shared';

const sampleConfig: PricingConfig = {
  currency: 'USD',
  base: {
    pool_only: {
      '15x30': [54000, 58000],
      '20x40': [72000, 80000],
    },
    pool_spa: {
      '15x30': [68000, 74000],
    },
  },
  addons: {
    salt_water: [1200, 2200],
    led_lighting: [800, 1500],
    waterfall: [3000, 5000],
  },
  minMaxMode: 'sum_ranges',
};

describe('computeEstimate', () => {
  describe('sum_ranges mode', () => {
    it('returns base price when no addons selected', () => {
      const input: PricingInput = { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] };
      const result = computeEstimate(sampleConfig, input);
      expect(result).toEqual({ min: 54000, max: 58000, currency: 'USD' });
    });

    it('adds addon deltas to base range', () => {
      const input: PricingInput = {
        baseKey: 'pool_only',
        sizeKey: '15x30',
        addonKeys: ['salt_water'],
      };
      const result = computeEstimate(sampleConfig, input);
      expect(result.min).toBe(54000 + 1200);
      expect(result.max).toBe(58000 + 2200);
    });

    it('sums multiple addons', () => {
      const input: PricingInput = {
        baseKey: 'pool_only',
        sizeKey: '15x30',
        addonKeys: ['salt_water', 'led_lighting'],
      };
      const result = computeEstimate(sampleConfig, input);
      expect(result.min).toBe(54000 + 1200 + 800);
      expect(result.max).toBe(58000 + 2200 + 1500);
    });

    it('ignores unknown addons gracefully', () => {
      const input: PricingInput = {
        baseKey: 'pool_only',
        sizeKey: '15x30',
        addonKeys: ['nonexistent_addon'],
      };
      const result = computeEstimate(sampleConfig, input);
      expect(result).toEqual({ min: 54000, max: 58000, currency: 'USD' });
    });

    it('uses different base categories', () => {
      const input: PricingInput = { baseKey: 'pool_spa', sizeKey: '15x30', addonKeys: [] };
      const result = computeEstimate(sampleConfig, input);
      expect(result).toEqual({ min: 68000, max: 74000, currency: 'USD' });
    });
  });

  describe('min_max_of_totals mode', () => {
    const configAlt: PricingConfig = { ...sampleConfig, minMaxMode: 'min_max_of_totals' };

    it('computes overall min and max from all combinations', () => {
      const input: PricingInput = {
        baseKey: 'pool_only',
        sizeKey: '15x30',
        addonKeys: ['salt_water'],
      };
      const result = computeEstimate(configAlt, input);
      // Totals: 54000+1200=55200, 54000+2200=56200, 58000+1200=59200, 58000+2200=60200
      expect(result.min).toBe(55200);
      expect(result.max).toBe(60200);
    });
  });

  describe('unknown base key or size', () => {
    it('returns zero for unknown base key', () => {
      const input: PricingInput = { baseKey: 'hot_tub', sizeKey: '15x30', addonKeys: [] };
      const result = computeEstimate(sampleConfig, input);
      expect(result).toEqual({ min: 0, max: 0, currency: 'USD' });
    });

    it('returns zero for unknown size key', () => {
      const input: PricingInput = { baseKey: 'pool_only', sizeKey: '50x100', addonKeys: [] };
      const result = computeEstimate(sampleConfig, input);
      expect(result).toEqual({ min: 0, max: 0, currency: 'USD' });
    });
  });

  describe('financing', () => {
    const configWithFinancing: PricingConfig = {
      ...sampleConfig,
      financing: { termMonths: 120, aprPercent: 6.99 },
    };

    it('includes monthly payment fields when financing is configured', () => {
      const input: PricingInput = { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] };
      const result = computeEstimate(configWithFinancing, input);
      expect(result.financing).toBeDefined();
      expect(result.financing!.termMonths).toBe(120);
      expect(result.financing!.aprPercent).toBe(6.99);
      expect(result.financing!.monthlyMin).toBeGreaterThan(0);
      expect(result.financing!.monthlyMax).toBeGreaterThan(result.financing!.monthlyMin);
    });

    it('handles 0% APR', () => {
      const zeroAprConfig: PricingConfig = {
        ...sampleConfig,
        financing: { termMonths: 60, aprPercent: 0 },
      };
      const input: PricingInput = { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] };
      const result = computeEstimate(zeroAprConfig, input);
      expect(result.financing!.monthlyMin).toBe(54000 / 60);
    });

    it('high APR (20%) produces higher monthly payment than low APR (3%)', () => {
      const base: PricingInput = { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] };
      const lowApr = computeEstimate(
        { ...sampleConfig, financing: { termMonths: 60, aprPercent: 3 } },
        base,
      );
      const highApr = computeEstimate(
        { ...sampleConfig, financing: { termMonths: 60, aprPercent: 20 } },
        base,
      );
      expect(highApr.financing!.monthlyMin).toBeGreaterThan(lowApr.financing!.monthlyMin);
    });

    it('monthly payment rounds to 2 decimal places', () => {
      const input: PricingInput = { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] };
      const result = computeEstimate(configWithFinancing, input);
      const decimals = (result.financing!.monthlyMin.toString().split('.')[1] ?? '').length;
      expect(decimals).toBeLessThanOrEqual(2);
    });

    it('termMonths=0 returns 0 monthly payment (no division by zero)', () => {
      const badConfig: PricingConfig = {
        ...sampleConfig,
        financing: { termMonths: 0, aprPercent: 6.99 },
      };
      const input: PricingInput = { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] };
      const result = computeEstimate(badConfig, input);
      expect(result.financing!.monthlyMin).toBe(0);
      expect(result.financing!.monthlyMax).toBe(0);
      expect(Number.isFinite(result.financing!.monthlyMin)).toBe(true);
    });
  });

  describe('multiple addons combined', () => {
    it('all three addons sum correctly', () => {
      const input: PricingInput = {
        baseKey: 'pool_only',
        sizeKey: '15x30',
        addonKeys: ['salt_water', 'led_lighting', 'waterfall'],
      };
      const result = computeEstimate(sampleConfig, input);
      expect(result.min).toBe(54000 + 1200 + 800 + 3000);
      expect(result.max).toBe(58000 + 2200 + 1500 + 5000);
    });

    it('known + unknown addons: unknown silently dropped, known applied', () => {
      const input: PricingInput = {
        baseKey: 'pool_only',
        sizeKey: '15x30',
        addonKeys: ['salt_water', 'nonexistent', 'waterfall'],
      };
      const result = computeEstimate(sampleConfig, input);
      expect(result.min).toBe(54000 + 1200 + 3000);
      expect(result.max).toBe(58000 + 2200 + 5000);
    });
  });

  describe('empty addons array', () => {
    it('returns base price unchanged with empty addonKeys', () => {
      const input: PricingInput = { baseKey: 'pool_only', sizeKey: '20x40', addonKeys: [] };
      const result = computeEstimate(sampleConfig, input);
      expect(result).toEqual({ min: 72000, max: 80000, currency: 'USD' });
    });

    it('no financing field when config.financing is absent', () => {
      const input: PricingInput = { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] };
      const result = computeEstimate(sampleConfig, input);
      expect(result.financing).toBeUndefined();
    });
  });

  describe('min_max_of_totals with multiple addons', () => {
    it('cross-product covers all base×addon combinations', () => {
      const config: PricingConfig = { ...sampleConfig, minMaxMode: 'min_max_of_totals' };
      // base: [54000,58000], salt_water: [1200,2200], led_lighting: [800,1500]
      // addonMin=2000, addonMax=3700
      // all totals: 54000+2000=56000, 54000+3700=57700, 58000+2000=60000, 58000+3700=61700
      const input: PricingInput = {
        baseKey: 'pool_only',
        sizeKey: '15x30',
        addonKeys: ['salt_water', 'led_lighting'],
      };
      const result = computeEstimate(config, input);
      expect(result.min).toBe(56000);
      expect(result.max).toBe(61700);
    });
  });
});
