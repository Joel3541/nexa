import { formatMoney, getCurrency } from '@nexa/config/locale';

/** Formatting helpers. Money always arrives from the API in minor units. */

export function money(minor: number, currency = 'GHS', locale = 'en-GH'): string {
  return formatMoney(minor, currency, { locale });
}

export function compactMoney(minor: number, currency = 'GHS', locale = 'en-GH'): string {
  return Math.abs(minor) >= 1_000_00
    ? formatMoney(minor, currency, { locale, compact: true })
    : formatMoney(minor, currency, { locale });
}

export function majorUnits(minor: number, currency = 'GHS'): number {
  return minor / 10 ** getCurrency(currency).decimals;
}

export function toMinor(value: string | number, currency = 'GHS'): number {
  const amount = typeof value === 'number' ? value : Number.parseFloat(value.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 10 ** getCurrency(currency).decimals);
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function shortDate(value: string | Date, locale = 'en-GH'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export function fullDate(value: string | Date, locale = 'en-GH'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateTime(value: string | Date, locale = 'en-GH'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function timeOnly(value: string | Date, locale = 'en-GH'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** Human-friendly relative time, e.g. "3 days ago", "in 2 hours". */
export function relativeTime(value: string | Date, now = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = date.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return 'just now';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), 'day');
  if (abs < 365 * day) return rtf.format(Math.round(diffMs / (30 * day)), 'month');
  return rtf.format(Math.round(diffMs / (365 * day)), 'year');
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Deterministic pastel from a string — used for customer/product avatars. */
export function avatarTint(seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return { bg: `hsl(${hue} 68% 92%)`, fg: `hsl(${hue} 55% 32%)` };
}
