import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { MetricDelta } from '@nexa/types';
import { percent } from '@/lib/format';
import { Badge, Button, Card, cx } from './primitives';

/* -------------------------------------------------------------------------- */
/* Table                                                                       */
/* -------------------------------------------------------------------------- */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Right-aligned and tabular — use for every money or count column. */
  numeric?: boolean;
  /** Hidden below `sm`. Mobile shows the primary columns only. */
  secondary?: boolean;
  width?: string;
}

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  onRowHref,
  empty,
  dense,
}: {
  rows: T[];
  columns: Array<Column<T>>;
  onRowHref?: (row: T) => string;
  empty?: ReactNode;
  dense?: boolean;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    // Wide tables scroll inside their own container so the page never does.
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cx(
                  'px-4 py-2.5 text-[12px] font-semibold tracking-wide uppercase subtle',
                  column.numeric && 'text-right',
                  column.secondary && 'hidden sm:table-cell',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = onRowHref?.(row);
            return (
              <tr
                key={row.id}
                className={cx(
                  'border-b border-[var(--border)] last:border-0 transition-colors',
                  href && 'hover:bg-[var(--surface-muted)]',
                )}
              >
                {columns.map((column, index) => {
                  const content = column.render(row);
                  return (
                    <td
                      key={column.key}
                      className={cx(
                        'px-4 align-middle',
                        dense ? 'py-2' : 'py-3',
                        column.numeric && 'text-right tnum',
                        column.secondary && 'hidden sm:table-cell',
                      )}
                    >
                      {/* The link covers the first cell so the whole row is
                          reachable by keyboard without nesting interactives. */}
                      {href && index === 0 ? (
                        <Link to={href} className="block font-medium hover:text-brand-600">
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5">
      <p className="text-[13px] muted tnum">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        <span className="px-1.5 text-[13px] muted tnum">
          {page} / {totalPages}
        </span>
        <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
          Next
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  delta,
  hint,
  series,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: string;
  delta?: MetricDelta;
  hint?: string;
  series?: number[];
  tone?: 'neutral' | 'positive' | 'negative';
  href?: string;
}) {
  const trendUp = delta?.direction === 'up';
  const trendDown = delta?.direction === 'down';
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium muted">{label}</p>
        {delta && delta.changePercent !== null && (
          <Badge tone={trendUp ? 'success' : trendDown ? 'danger' : 'neutral'}>
            {trendUp ? '↑' : trendDown ? '↓' : '→'} {percent(Math.abs(delta.changePercent), 1).replace('+', '')}
          </Badge>
        )}
      </div>
      <p
        className={cx(
          'mt-1.5 text-[26px] leading-none font-semibold tnum',
          tone === 'positive' && 'text-emerald-600',
          tone === 'negative' && 'text-red-600',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[12.5px] subtle">{hint}</p>}
      {series && series.length > 1 && (
        <div className="mt-3 h-9 chart-frame">
          <Sparkline data={series} positive={!trendDown} />
        </div>
      )}
    </>
  );

  if (href) {
    return (
      <Link to={href} className="block">
        <Card className="h-full transition-shadow hover:shadow-md">{body}</Card>
      </Link>
    );
  }
  return <Card className="h-full">{body}</Card>;
}

export function Sparkline({ data, positive = true }: { data: number[]; positive?: boolean }) {
  const points = data.map((value, index) => ({ index, value }));
  const stroke = positive ? 'var(--color-brand-500)' : '#ef4444';
  const id = `spark-${positive ? 'up' : 'down'}`;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={stroke}
          strokeWidth={1.8}
          fill={`url(#${id})`}
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                        */
/* -------------------------------------------------------------------------- */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto border-b border-[var(--border)]', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={cx(
            '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors',
            active === tab.id
              ? 'border-brand-600 text-brand-700 dark:text-brand-300'
              : 'border-transparent muted hover:text-[var(--text)]',
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 tnum subtle">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
