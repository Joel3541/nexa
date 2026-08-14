import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsResponse } from '@nexa/types';
import { PageHeader, StatTile } from '@/components/ui/data';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { Card, CardHeader, Select } from '@/components/ui/primitives';
import { compactMoney, money, percent, shortDate, titleCase } from '@/lib/format';
import { chartLabel, chartNumber } from '@/lib/charts';
import { api } from '@/lib/api';
import { useSession } from '@/store/session';

/**
 * Categorical palette.
 *
 * Ordered so adjacent slices stay distinguishable, and chosen to remain
 * legible against both light and dark surfaces.
 */
const SERIES_COLORS = ['#6b63f2', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#f97316'];

const RANGES = [
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: '180', label: 'Last 6 months' },
  { id: '365', label: 'Last 12 months' },
];

export default function AnalyticsPage() {
  const { currency, locale } = useSession();
  const [range, setRange] = useState('90');
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('week');

  const from = new Date(Date.now() - Number(range) * 24 * 60 * 60 * 1000).toISOString();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['analytics', range, granularity],
    queryFn: () => api.get<AnalyticsResponse>('/analytics', { from, granularity }),
  });

  const fmt = (minor: number) => money(minor, currency, locale);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Where the money came from, and where it went."
        actions={
          <>
            <Select value={range} onChange={(event) => setRange(event.target.value)} className="w-auto">
              {RANGES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              value={granularity}
              onChange={(event) => setGranularity(event.target.value as 'day' | 'week' | 'month')}
              className="w-auto"
            >
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </Select>
          </>
        }
      />

      {isError ? (
        <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Revenue"
              value={fmt(data.revenue.total)}
              hint={`${percent(changePercent(data.revenue.total, data.revenue.previousTotal))} vs previous period`}
            />
            <StatTile
              label="Expenses"
              value={fmt(data.expenses.total)}
              hint={`${percent(changePercent(data.expenses.total, data.expenses.previousTotal))} vs previous period`}
            />
            <StatTile
              label="Profit"
              value={fmt(data.profit.total)}
              tone={data.profit.total >= 0 ? 'positive' : 'negative'}
              hint={`${percent(changePercent(data.profit.total, data.profit.previousTotal))} vs previous period`}
            />
            <StatTile
              label="Orders"
              value={String(data.orders.total)}
              hint={
                data.orders.total > 0
                  ? `Average ${fmt(Math.round(data.revenue.total / data.orders.total))}`
                  : 'No orders in range'
              }
            />
          </div>

          <Card>
            <CardHeader title="Revenue, expenses and profit" subtitle={titleCase(granularity)} />
            <div className="h-80 chart-frame">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.revenue.series.map((point, index) => ({
                    label: shortDate(point.date, locale),
                    revenue: point.value / 100,
                    expenses: (data.expenses.series[index]?.value ?? 0) / 100,
                    profit: (data.profit.series[index]?.value ?? 0) / 100,
                  }))}
                  margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-subtle)' }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--text-subtle)' }}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                    tickFormatter={(value: number) => compactMoney(value * 100, currency, locale)}
                  />
                  <RTooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12.5 }}
                    formatter={(value: unknown, name: unknown) => [fmt(Math.round(chartNumber(value) * 100)), titleCase(chartLabel(name))]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12.5 }} />
                  <Line type="monotone" dataKey="revenue" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="expenses" stroke={SERIES_COLORS[3]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="profit" stroke={SERIES_COLORS[2]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Where the money goes" subtitle="Expenses by category" />
              {data.expenseBreakdown.length === 0 ? (
                <p className="py-10 text-center text-[13.5px] muted">No expenses recorded in this range.</p>
              ) : (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="h-52 chart-frame sm:w-1/2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.expenseBreakdown}
                          dataKey="amountMinor"
                          nameKey="category"
                          innerRadius="55%"
                          outerRadius="88%"
                          paddingAngle={2}
                          isAnimationActive={false}
                        >
                          {data.expenseBreakdown.map((_, index) => (
                            <Cell key={index} fill={SERIES_COLORS[index % SERIES_COLORS.length]} stroke="none" />
                          ))}
                        </Pie>
                        <RTooltip
                          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12.5 }}
                          formatter={(value: unknown) => fmt(chartNumber(value))}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="flex-1 space-y-2">
                    {data.expenseBreakdown.slice(0, 7).map((row, index) => (
                      <li key={row.category} className="flex items-center gap-2.5 text-[13px]">
                        <span
                          className="size-2.5 shrink-0 rounded-sm"
                          style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}
                        />
                        <span className="min-w-0 flex-1 truncate">{row.category}</span>
                        <span className="shrink-0 tnum">{fmt(row.amountMinor)}</span>
                        <span className="w-10 shrink-0 text-right tnum subtle">{Math.round(row.share)}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="How customers pay" subtitle="Payment mix in this range" />
              {data.paymentMix.length === 0 ? (
                <p className="py-10 text-center text-[13.5px] muted">No payments recorded in this range.</p>
              ) : (
                <div className="h-52 chart-frame">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.paymentMix.map((row) => ({ method: titleCase(row.method), value: row.amountMinor / 100 }))}
                      layout="vertical"
                      margin={{ top: 0, right: 12, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11, fill: 'var(--text-subtle)' }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value: number) => compactMoney(value * 100, currency, locale)}
                      />
                      <YAxis type="category" dataKey="method" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={100} />
                      <RTooltip
                        contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12.5 }}
                        formatter={(value: unknown) => fmt(Math.round(chartNumber(value) * 100))}
                      />
                      <Bar dataKey="value" fill={SERIES_COLORS[1]} radius={[0, 5, 5, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Product performance" subtitle="By revenue, with profit" />
              {data.productPerformance.length === 0 ? (
                <p className="py-10 text-center text-[13.5px] muted">No sales in this range.</p>
              ) : (
                <div className="-mx-4 overflow-x-auto sm:mx-0">
                  <table className="w-full min-w-[28rem] text-[13.5px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left">
                        <th className="px-4 py-2 text-[12px] font-semibold uppercase subtle">Product</th>
                        <th className="px-4 py-2 text-right text-[12px] font-semibold uppercase subtle">Units</th>
                        <th className="px-4 py-2 text-right text-[12px] font-semibold uppercase subtle">Revenue</th>
                        <th className="px-4 py-2 text-right text-[12px] font-semibold uppercase subtle">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.productPerformance.map((row) => (
                        <tr key={row.id || row.name} className="border-b border-[var(--border)] last:border-0">
                          <td className="px-4 py-2.5">{row.name}</td>
                          <td className="px-4 py-2.5 text-right tnum">{row.unitsSold}</td>
                          <td className="px-4 py-2.5 text-right tnum">{fmt(row.revenueMinor)}</td>
                          <td className="px-4 py-2.5 text-right tnum text-positive">{fmt(row.profitMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="Customers" subtitle="Activity and retention" />
              <dl className="grid grid-cols-2 gap-4">
                {[
                  ['Active (60 days)', String(data.customers.activeCount)],
                  ['Gone quiet', String(data.customers.inactiveCount)],
                  ['New this period', String(data.customers.newCount)],
                  ['Repeat buyers', String(data.customers.returningCount)],
                  ['Retention rate', data.customers.retentionRate === null ? '—' : `${Math.round(data.customers.retentionRate)}%`],
                  ['Repeat rate', data.customers.repeatRate === null ? '—' : `${Math.round(data.customers.repeatRate)}%`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-[var(--border)] p-3">
                    <dt className="text-[12.5px] muted">{label}</dt>
                    <dd className="mt-1 text-[20px] font-semibold tnum">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3.5 text-[13px]">
                <p className="font-medium">Outstanding</p>
                <p className="mt-1 muted">
                  {fmt(data.outstanding.totalMinor)} across {data.outstanding.invoiceCount} open invoices.{' '}
                  {data.outstanding.overdueCount > 0 ? (
                    <span className="text-negative">
                      {fmt(data.outstanding.overdueMinor)} of it is overdue ({data.outstanding.overdueCount} invoices).
                    </span>
                  ) : (
                    'Nothing is overdue.'
                  )}
                </p>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
