import type { PricingConfig, PricingInput, PricingResult } from '@repo/shared';

/**
 * Computes an estimate range from a pricing configuration and user selections.
 *
 * The engine is JSON-driven:
 *   - `base` maps a category key → size key → [min, max] tuple
 *   - `addons` maps an addon key → [min, max] delta tuple
 *   - `minMaxMode` controls aggregation:
 *       • "sum_ranges" — sum all mins for the low end, sum all maxes for the high end
 *       • "min_max_of_totals" — compute each possible total, then take overall min/max
 *   - `financing` (optional) — compute monthly payment from the range
 */
export function computeEstimate(
  config: PricingConfig,
  input: PricingInput,
): PricingResult {
  // ── Resolve base price range ──
  const baseCategory = config.base[input.baseKey];
  if (!baseCategory) {
    return zeroResult(config.currency);
  }

  const baseRange = baseCategory[input.sizeKey];
  if (!baseRange) {
    return zeroResult(config.currency);
  }

  const [baseMin, baseMax] = baseRange;

  // ── Resolve addon deltas ──
  let addonMinTotal = 0;
  let addonMaxTotal = 0;

  for (const addonKey of input.addonKeys) {
    const addonRange = config.addons[addonKey];
    if (addonRange) {
      addonMinTotal += addonRange[0];
      addonMaxTotal += addonRange[1];
    }
    // Unknown addons are silently ignored (graceful degradation)
  }

  // ── Aggregate ──
  let min: number;
  let max: number;

  switch (config.minMaxMode) {
    case 'sum_ranges':
      min = baseMin + addonMinTotal;
      max = baseMax + addonMaxTotal;
      break;

    case 'min_max_of_totals': {
      const totals = [
        baseMin + addonMinTotal,
        baseMin + addonMaxTotal,
        baseMax + addonMinTotal,
        baseMax + addonMaxTotal,
      ];
      min = Math.min(...totals);
      max = Math.max(...totals);
      break;
    }

    default:
      // Default to sum_ranges
      min = baseMin + addonMinTotal;
      max = baseMax + addonMaxTotal;
  }

  // ── Financing (optional) ──
  const result: PricingResult = { min, max, currency: config.currency };

  if (config.financing) {
    const { termMonths, aprPercent } = config.financing;
    result.financing = {
      monthlyMin: computeMonthlyPayment(min, aprPercent, termMonths),
      monthlyMax: computeMonthlyPayment(max, aprPercent, termMonths),
      termMonths,
      aprPercent,
    };
  }

  return result;
}

/**
 * Standard amortization formula for monthly payment.
 */
function computeMonthlyPayment(
  principal: number,
  annualRatePercent: number,
  termMonths: number,
): number {
  if (termMonths <= 0) return 0;

  if (annualRatePercent === 0) {
    return Math.round((principal / termMonths) * 100) / 100;
  }

  const monthlyRate = annualRatePercent / 100 / 12;
  const factor = Math.pow(1 + monthlyRate, termMonths);
  const payment = (principal * monthlyRate * factor) / (factor - 1);
  return Math.round(payment * 100) / 100;
}

function zeroResult(currency: string): PricingResult {
  return { min: 0, max: 0, currency };
}
