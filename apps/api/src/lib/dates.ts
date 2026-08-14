/**
 * Date/period helpers.
 *
 * All persisted timestamps are UTC. Period boundaries are computed on UTC day
 * edges; a business timezone is carried on the record so a future revision can
 * shift boundaries per business without touching call sites.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'all_time';

export interface Period {
  from: Date;
  to: Date;
  label: string;
  /** Equal-length window immediately preceding `from`, for comparisons. */
  previous: { from: Date; to: Date };
}

export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

export function endOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

export function resolvePeriod(key: PeriodKey, now: Date = new Date()): Period {
  const today = startOfDay(now);
  const build = (from: Date, to: Date, label: string): Period => {
    const span = Math.max(to.getTime() - from.getTime(), DAY_MS);
    return {
      from,
      to,
      label,
      previous: { from: new Date(from.getTime() - span), to: new Date(from.getTime() - 1) },
    };
  };

  switch (key) {
    case 'today':
      return build(today, endOfDay(now), 'Today');
    case 'yesterday': {
      const yesterday = addDays(today, -1);
      return build(yesterday, endOfDay(yesterday), 'Yesterday');
    }
    case 'last_7_days':
      return build(addDays(today, -6), endOfDay(now), 'Last 7 days');
    case 'last_90_days':
      return build(addDays(today, -89), endOfDay(now), 'Last 90 days');
    case 'this_month':
      return build(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), endOfDay(now), 'This month');
    case 'last_month': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
      return build(from, to, 'Last month');
    }
    case 'this_year':
      return build(new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), endOfDay(now), 'This year');
    case 'all_time':
      return build(new Date(Date.UTC(2000, 0, 1)), endOfDay(now), 'All time');
    case 'last_30_days':
    default:
      return build(addDays(today, -29), endOfDay(now), 'Last 30 days');
  }
}

/** Builds a Period from explicit ISO bounds, defaulting to the last 30 days. */
export function periodFromRange(from?: string, to?: string, now: Date = new Date()): Period {
  if (!from && !to) return resolvePeriod('last_30_days', now);
  const start = from ? startOfDay(new Date(from)) : addDays(startOfDay(now), -29);
  const end = to ? endOfDay(new Date(to)) : endOfDay(now);
  const span = Math.max(end.getTime() - start.getTime(), DAY_MS);
  return {
    from: start,
    to: end,
    label: `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
    previous: { from: new Date(start.getTime() - span), to: new Date(start.getTime() - 1) },
  };
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Dense day-by-day buckets so charts never show gaps. */
export function enumerateDays(from: Date, to: Date): string[] {
  const days: string[] = [];
  let cursor = startOfDay(from);
  const end = startOfDay(to);
  while (cursor <= end && days.length < 400) {
    days.push(isoDay(cursor));
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function bucketKey(date: Date, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'month') return `${date.toISOString().slice(0, 7)}-01`;
  if (granularity === 'week') {
    const day = startOfDay(date);
    const weekday = (day.getUTCDay() + 6) % 7; // Monday = 0
    return isoDay(addDays(day, -weekday));
  }
  return isoDay(date);
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function changeDirection(change: number | null): 'up' | 'down' | 'flat' {
  if (change === null || Math.abs(change) < 0.5) return 'flat';
  return change > 0 ? 'up' : 'down';
}
