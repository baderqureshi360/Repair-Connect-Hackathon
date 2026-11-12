/**
 * Minimum sample sizes before marketplace/portal surfaces a percentage or average.
 * Below threshold → "Not enough data" (value null, enoughData false).
 */
export const SUPPLIER_PERFORMANCE_MIN_SAMPLES = {
  fulfilmentRate: 3,
  onTimeDelivery: 3,
  quotationResponse: 3,
  cancellationRate: 5,
  verifiedReviews: 3
} as const;

export type PerformanceMetric<T = number> = {
  value: T | null;
  sampleCount: number;
  enoughData: boolean;
  label: string;
};

export function metricOrInsufficient<T>(
  value: T | null,
  sampleCount: number,
  minSamples: number,
  format?: (v: T) => string
): PerformanceMetric<T> {
  const enoughData = sampleCount >= minSamples && value !== null && value !== undefined;
  return {
    value: enoughData ? value : null,
    sampleCount,
    enoughData,
    label: enoughData
      ? format
        ? format(value as T)
        : String(value)
      : sampleCount === 0
        ? 'No eligible transactions'
        : 'Not enough data'
  };
}
