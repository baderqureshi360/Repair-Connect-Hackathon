/** Resolve semantic chart colors from CSS tokens (light/dark aware). */
const FALLBACK = ['#4f46e5', '#1565c0', '#0f766e', '#b45309', '#64748b', '#c62828', '#4b5563'];

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function chartPalette(): string[] {
  return [1, 2, 3, 4, 5, 6, 7].map((i) => readVar(`--color-chart-${i}`, FALLBACK[i - 1]));
}

export function chartSeriesColor(index: number): string {
  const palette = chartPalette();
  return palette[index % palette.length];
}

export function chartTickColor(): string {
  return readVar('--color-chart-tick', '#6b7280');
}

export function chartLabelColor(): string {
  return readVar('--color-chart-label', '#212529');
}

export function chartGridColor(): string {
  return readVar('--color-chart-grid', 'rgba(33, 37, 41, 0.06)');
}
