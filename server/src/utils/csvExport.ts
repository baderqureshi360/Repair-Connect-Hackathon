/**
 * CSV helpers with spreadsheet formula-injection protection.
 * Cells that look like formulas are prefixed with a single quote.
 */
export function csvEscapeCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s)) {
    s = `'${s}`;
  }
  // JSON.stringify wraps in quotes and escapes inner quotes — safe CSV cell.
  return JSON.stringify(s);
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) {
    return 'empty\n';
  }
  const keys = Object.keys(rows[0]);
  const header = keys.map(csvEscapeCell).join(',');
  const body = rows.map((row) => keys.map((k) => csvEscapeCell(row[k])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

/** Inclusive UTC day range from ISO date or datetime strings. */
export function parseAnalyticsDateRange(from?: string, to?: string) {
  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  if (from) {
    fromDate = new Date(from);
    if (Number.isNaN(fromDate.getTime())) throw new Error('Invalid from date');
    if (/^\d{4}-\d{2}-\d{2}$/.test(from.trim())) {
      fromDate = new Date(`${from.trim()}T00:00:00.000Z`);
    }
  }
  if (to) {
    toDate = new Date(to);
    if (Number.isNaN(toDate.getTime())) throw new Error('Invalid to date');
    if (/^\d{4}-\d{2}-\d{2}$/.test(to.trim())) {
      toDate = new Date(`${to.trim()}T23:59:59.999Z`);
    }
  }
  return { fromDate, toDate };
}

export function monthKeyUtc(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
