/**
 * Recharts helpers.
 *
 * Recharts types tooltip/axis callback values as a broad union that can be
 * undefined. Rather than casting at every call site, these adapters coerce once
 * and keep the chart code readable.
 */

export function chartNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function chartLabel(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

/** Shared tooltip chrome so every chart in the product looks identical. */
export const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  fontSize: 12.5,
} as const;
