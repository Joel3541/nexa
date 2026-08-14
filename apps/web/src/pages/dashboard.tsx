import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BusinessHealth, DailyBrief, DashboardResponse } from '@nexa/types';
import { ArrowRightIcon, SparkIcon } from '@/components/icons';
import { PageHeader, StatTile } from '@/components/ui/data';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { Badge, Button, Card, CardHeader, Select, cx } from '@/components/ui/primitives';
import { compactMoney, money, relativeTime, shortDate } from '@/lib/format';
import { chartLabel, chartNumber } from '@/lib/charts';
import { api } from '@/lib/api';
import { useSession } from '@/store/session';

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'last_30_days', label: 'Last 30 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_90_days', label: 'Last 90 days' },
] as const;

export default function DashboardPage() {
  const { session, currency, locale } = useSession();
  const [period, setPeriod] = useState<string>('last_30_days');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', period],
    queryFn: () => api.get<DashboardResponse>('/dashboard', { period }),
  });

  if (isError) {
    return (
      <ErrorState
        title="We couldn't load your dashboard"
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={session?.business?.name ?? 'Dashboard'}
        subtitle={data ? data.range.label : 'Loading your business…'}
        actions={
          <>
            <Select value={period} onChange={(event) => setPeriod(event.target.value)} className="w-auto">
              {PERIODS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Link to="/app/sales/new">
              <Button variant="primary">Record a sale</Button>
            </Link>
          </>
        }
      />

      {isLoading || !data ? (
        <DashboardSkeleton />
      ) : (
        // `stagger` walks direct children in ~45ms apart, so the eye lands on
        // the brief, then the headline numbers, then the detail — the order
        // they should be read in.
        <div className="stagger space-y-5">
          <BriefCard brief={data.brief} />

          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Revenue"
              value={money(data.finance.revenue.value, currency, locale)}
              delta={data.finance.revenue}
              series={data.series.map((point) => point.revenue)}
              hint={`vs ${money(data.finance.revenue.previous, currency, locale)} previous period`}
            />
            <StatTile
              label="Expenses"
              value={money(data.finance.expenses.value, currency, locale)}
              delta={data.finance.expenses}
              hint={`vs ${money(data.finance.expenses.previous, currency, locale)} previous period`}
            />
            <StatTile
              label="Profit"
              value={money(data.finance.profit.value, currency, locale)}
              delta={data.finance.profit}
              tone={data.finance.profit.value >= 0 ? 'positive' : 'negative'}
              hint="Revenue less tax, cost of goods and expenses"
            />
            <StatTile
              label="Owed to you"
              value={money(data.finance.outstandingMinor, currency, locale)}
              hint={
                data.finance.overdueMinor > 0
                  ? `${money(data.finance.overdueMinor, currency, locale)} of it is overdue`
                  : 'Nothing overdue'
              }
              tone={data.finance.overdueMinor > 0 ? 'negative' : 'neutral'}
              href="/app/invoices?overdue=1"
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <RevenueChart data={data} />
            <HealthCard health={data.health} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <OverdueCard rows={data.overdueInvoices} />
            <LowStockCard rows={data.lowStock} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <TopListCard
              title="Best sellers"
              subtitle="By revenue this period"
              href="/app/products"
              rows={data.topProducts.map((product) => ({
                id: product.id,
                title: product.name,
                meta: `${product.unitsSold} sold`,
                value: money(product.revenueMinor, currency, locale),
                href: `/app/products/${product.id}`,
              }))}
              empty="No sales recorded in this period yet."
            />
            <TopListCard
              title="Top customers"
              subtitle="By lifetime spend"
              href="/app/customers"
              rows={data.topCustomers.map((customer) => ({
                id: customer.id,
                title: customer.name,
                meta: `${customer.orderCount} orders`,
                value: money(customer.totalSpentMinor, currency, locale),
                href: `/app/customers/${customer.id}`,
              }))}
              empty="No customers with purchases yet."
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <UpcomingTasks rows={data.upcoming.tasks} />
            <UpcomingAppointments rows={data.upcoming.appointments} />
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function BriefCard({ brief }: { brief: DailyBrief }) {
  const severityColor = {
    critical: 'bg-red-500',
    warning: 'bg-amber-500',
    success: 'bg-emerald-500',
    info: 'bg-sky-500',
  } as const;

  return (
    <Card className="border-brand-200 bg-gradient-to-br from-brand-50/80 to-transparent dark:border-brand-900 dark:from-brand-950/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-accent uppercase">
            <SparkIcon className="size-3.5" />
            NEXA Morning Brief
          </p>
          <h2 className="mt-2 text-[19px] font-semibold">{brief.greeting}</h2>
          <p className="mt-0.5 text-[15px] muted">{brief.headline}</p>
        </div>
        <Link to="/app/assistant" className="shrink-0">
          <Button size="sm" icon={<SparkIcon className="size-4" />}>
            Ask NEXA
          </Button>
        </Link>
      </div>

      <ul className="mt-4 space-y-2.5">
        {brief.highlights.map((highlight) => (
          <li key={highlight.id} className="flex gap-2.5 text-[14px]">
            <span className={cx('mt-[7px] size-2 shrink-0 rounded-full', severityColor[highlight.severity])} />
            <span className="min-w-0">
              <span>{highlight.title}</span>{' '}
              <span className="muted">{highlight.detail}</span>
              {highlight.actionHref && (
                <Link to={highlight.actionHref} className="ml-1.5 font-medium whitespace-nowrap text-accent hover:underline">
                  {highlight.actionLabel} →
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>

      {brief.recommendation && (
        <div className="mt-4 rounded-xl border border-brand-200 bg-[var(--surface)] p-4 dark:border-brand-800">
          <p className="text-[12px] font-semibold tracking-wide text-accent uppercase">Recommended action</p>
          <p className="mt-1.5 text-[15px] font-medium">{brief.recommendation.title}</p>
          <p className="mt-1 text-[13.5px] muted">{brief.recommendation.rationale}</p>
          <Link to={brief.recommendation.actionHref} className="mt-3 inline-block">
            <Button variant="primary" size="sm" icon={<ArrowRightIcon className="size-4" />}>
              {brief.recommendation.actionLabel}
            </Button>
          </Link>
        </div>
      )}

      {/* Honest about provenance: this brief is composed from retrieved
          metrics, so we say so rather than implying a model wrote it. */}
      <p className="mt-3 text-[11.5px] subtle">
        {brief.aiGenerated ? 'Written by NEXA AI from your records.' : 'Assembled from your records — every figure is retrieved, never estimated.'}{' '}
        Updated {relativeTime(brief.generatedAt)}.
      </p>
    </Card>
  );
}

function RevenueChart({ data }: { data: DashboardResponse }) {
  const { currency, locale } = useSession();
  const points = data.series.map((point) => ({
    date: point.date,
    label: shortDate(point.date, locale),
    revenue: point.revenue / 100,
    expenses: point.expenses / 100,
  }));

  return (
    <Card>
      <CardHeader
        title="Revenue and expenses"
        subtitle={data.range.label}
        action={
          <Link to="/app/analytics" className="text-[13px] font-medium text-accent hover:underline">
            Full analytics →
          </Link>
        }
      />
      <div className="h-64 chart-frame">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity={0.32} />
                <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--text-subtle)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-subtle)' }}
              tickLine={false}
              axisLine={false}
              width={54}
              tickFormatter={(value: number) => compactMoney(value * 100, currency, locale)}
            />
            <RTooltip
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                fontSize: 12.5,
              }}
              formatter={(value: unknown, name: unknown) => [money(Math.round(chartNumber(value) * 100), currency, locale), chartLabel(name) === 'revenue' ? 'Revenue' : 'Expenses']}
            />
            <Area type="monotone" dataKey="revenue" stroke="var(--color-brand-500)" strokeWidth={2} fill="url(#rev)" />
            <Area type="monotone" dataKey="expenses" stroke="#f59e0b" strokeWidth={1.6} fill="none" strokeDasharray="4 3" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function HealthCard({ health }: { health: BusinessHealth }) {
  const gradeTone = {
    excellent: 'text-positive',
    good: 'text-positive',
    fair: 'text-warning',
    at_risk: 'text-negative',
  }[health.grade];

  const statusColor = { good: 'bg-emerald-500', watch: 'bg-amber-500', risk: 'bg-red-500' } as const;

  return (
    <Card>
      <CardHeader title="Business health" subtitle="Weighted across six factors" />
      <div className="flex items-baseline gap-2">
        <span className={cx('text-[40px] leading-none font-semibold tnum', gradeTone)}>{health.score}</span>
        <span className="text-[15px] muted">/ 100</span>
        <Badge tone={health.grade === 'at_risk' ? 'danger' : health.grade === 'fair' ? 'warning' : 'success'} className="ml-auto">
          {health.grade.replace('_', ' ')}
        </Badge>
      </div>

      <ul className="mt-5 space-y-3">
        {health.factors.map((factor) => (
          <li key={factor.key}>
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="flex items-center gap-2 font-medium">
                <span className={cx('size-1.5 rounded-full', statusColor[factor.status])} />
                {factor.label}
              </span>
              <span className="tnum subtle">{factor.score}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
              <div
                className={cx('h-full rounded-full transition-all', statusColor[factor.status])}
                style={{ width: `${factor.score}%` }}
              />
            </div>
            <p className="mt-1 text-[12px] subtle">{factor.detail}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OverdueCard({ rows }: { rows: DashboardResponse['overdueInvoices'] }) {
  const { currency, locale } = useSession();
  return (
    <Card>
      <CardHeader
        title="Overdue invoices"
        subtitle={rows.length === 0 ? 'Nothing overdue' : 'Oldest first'}
        action={
          <Link to="/app/invoices?overdue=1" className="text-[13px] font-medium text-accent hover:underline">
            View all →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] muted">Every invoice is within terms. Nothing to chase.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((invoice) => (
            <li key={invoice.id}>
              <Link to={`/app/invoices/${invoice.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-accent">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">{invoice.customerName}</p>
                  <p className="text-[12.5px] subtle">
                    {invoice.number} · {invoice.daysOverdue} days overdue
                  </p>
                </div>
                <span className="shrink-0 text-[14px] font-semibold tnum text-negative">
                  {money(invoice.balanceMinor, currency, locale)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LowStockCard({ rows }: { rows: DashboardResponse['lowStock'] }) {
  return (
    <Card>
      <CardHeader
        title="Stock needing attention"
        subtitle={rows.length === 0 ? 'All good' : 'At or below minimum'}
        action={
          <Link to="/app/products?lowStock=1" className="text-[13px] font-medium text-accent hover:underline">
            View all →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] muted">Nothing is running low.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((product) => (
            <li key={product.id}>
              <Link to={`/app/products/${product.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-accent">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">{product.name}</p>
                  <p className="text-[12.5px] subtle">
                    {product.quantity} left · minimum {product.minStock}
                  </p>
                </div>
                <Badge tone={product.quantity === 0 ? 'danger' : product.daysRemaining !== null && product.daysRemaining <= 10 ? 'warning' : 'neutral'}>
                  {product.quantity === 0
                    ? 'Out of stock'
                    : product.daysRemaining === null
                      ? 'No recent sales'
                      : `~${product.daysRemaining} days left`}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TopListCard({
  title,
  subtitle,
  href,
  rows,
  empty,
}: {
  title: string;
  subtitle: string;
  href: string;
  rows: Array<{ id: string; title: string; meta: string; value: string; href: string }>;
  empty: string;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={
          <Link to={href} className="text-[13px] font-medium text-accent hover:underline">
            View all →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] muted">{empty}</p>
      ) : (
        <ol className="divide-y divide-[var(--border)]">
          {rows.map((row, index) => (
            <li key={row.id}>
              <Link to={row.href} className="flex items-center gap-3 py-2.5 hover:text-accent">
                <span className="w-4 shrink-0 text-[12.5px] subtle tnum">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{row.title}</p>
                  <p className="text-[12.5px] subtle">{row.meta}</p>
                </div>
                <span className="shrink-0 text-[14px] font-semibold tnum">{row.value}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function UpcomingTasks({ rows }: { rows: DashboardResponse['upcoming']['tasks'] }) {
  return (
    <Card>
      <CardHeader
        title="Open tasks"
        action={
          <Link to="/app/tasks" className="text-[13px] font-medium text-accent hover:underline">
            All tasks →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] muted">No open tasks. Enjoy it.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium">{task.title}</p>
                <p className="text-[12.5px] subtle">
                  {task.customerName ? `${task.customerName} · ` : ''}
                  {task.dueDate ? `Due ${relativeTime(task.dueDate)}` : 'No due date'}
                </p>
              </div>
              <Badge tone={task.isOverdue ? 'danger' : task.priority === 'urgent' ? 'warning' : 'neutral'}>
                {task.isOverdue ? 'Overdue' : task.priority}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function UpcomingAppointments({ rows }: { rows: DashboardResponse['upcoming']['appointments'] }) {
  const { locale } = useSession();
  return (
    <Card>
      <CardHeader
        title="Coming up"
        subtitle="Next 7 days"
        action={
          <Link to="/app/appointments" className="text-[13px] font-medium text-accent hover:underline">
            Calendar →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] muted">Nothing booked this week.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((appointment) => (
            <li key={appointment.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium">{appointment.title}</p>
                <p className="text-[12.5px] subtle">{appointment.customerName ?? 'No customer'}</p>
              </div>
              <span className="shrink-0 text-[12.5px] subtle">
                {new Date(appointment.startsAt).toLocaleString(locale, {
                  weekday: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-52" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
