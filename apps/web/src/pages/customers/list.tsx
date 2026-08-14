import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CustomerView, Paginated } from '@nexa/types';
import { PlusIcon, UsersIcon } from '@/components/icons';
import { DataTable, PageHeader, Pagination, Tabs } from '@/components/ui/data';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Avatar, Badge, Button, Card, Input } from '@/components/ui/primitives';
import { money, relativeTime, titleCase } from '@/lib/format';
import { api } from '@/lib/api';
import { useSession } from '@/store/session';

const SEGMENTS = [
  { id: '', label: 'All' },
  { id: 'vip', label: 'VIP' },
  { id: 'repeat', label: 'Repeat' },
  { id: 'new', label: 'New' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'owes_money', label: 'Owes money' },
] as const;

export default function CustomersPage() {
  const { currency, locale, can } = useSession();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const segment = params.get('segment') ?? '';
  const sort = params.get('sort') ?? 'spend';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['customers', { page, search, segment, sort }],
    queryFn: () =>
      api.get<Paginated<CustomerView>>('/customers', {
        page,
        pageSize: 25,
        q: search || undefined,
        segment: segment || undefined,
        sort,
      }),
  });

  function setSegment(next: string) {
    const query = new URLSearchParams(params);
    if (next) query.set('segment', next);
    else query.delete('segment');
    setParams(query);
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={data ? `${data.total} in your CRM` : undefined}
        actions={
          can('customers:write') && (
            <Link to="/app/customers/new">
              <Button variant="primary" icon={<PlusIcon className="size-4" />}>
                Add customer
              </Button>
            </Link>
          )
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name, phone or email…"
            className="max-w-xs"
            aria-label="Search customers"
          />
        </div>

        <Tabs
          tabs={SEGMENTS.map((s) => ({ id: s.id, label: s.label }))}
          active={segment as ''}
          onChange={setSegment}
          className="px-4"
        />

        <div className="p-4">
          {isError ? (
            <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
          ) : isLoading ? (
            <TableSkeleton rows={6} columns={5} />
          ) : (
            <>
              <DataTable
                rows={data?.data ?? []}
                onRowHref={(row) => `/app/customers/${row.id}`}
                empty={
                  <EmptyState
                    icon={<UsersIcon />}
                    title={search || segment ? 'No customers match that' : 'No customers yet'}
                    message={
                      search || segment
                        ? 'Try a different search or segment.'
                        : 'Add your first customer to start tracking who buys what, and who owes you.'
                    }
                    action={
                      can('customers:write') && !search && !segment ? (
                        <Link to="/app/customers/new">
                          <Button variant="primary">Add customer</Button>
                        </Link>
                      ) : undefined
                    }
                  />
                }
                columns={[
                  {
                    key: 'name',
                    header: 'Customer',
                    render: (row) => (
                      <span className="flex items-center gap-2.5">
                        <Avatar name={row.name} size={30} />
                        <span className="min-w-0">
                          <span className="block truncate">{row.name}</span>
                          <span className="block truncate text-[12px] font-normal subtle">
                            {row.phone ?? row.email ?? '—'}
                          </span>
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: 'segments',
                    header: 'Segments',
                    secondary: true,
                    render: (row) =>
                      row.segments.length === 0 ? (
                        <span className="subtle">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {row.segments.slice(0, 2).map((s) => (
                            <Badge key={s} tone={s === 'inactive' ? 'warning' : s === 'owes_money' ? 'danger' : s === 'vip' ? 'brand' : 'neutral'}>
                              {titleCase(s)}
                            </Badge>
                          ))}
                        </span>
                      ),
                  },
                  {
                    key: 'orders',
                    header: 'Orders',
                    numeric: true,
                    secondary: true,
                    render: (row) => row.orderCount,
                  },
                  {
                    key: 'spent',
                    header: 'Lifetime value',
                    numeric: true,
                    render: (row) => <span className="font-medium">{money(row.totalSpentMinor, currency, locale)}</span>,
                  },
                  {
                    key: 'owed',
                    header: 'Owes',
                    numeric: true,
                    secondary: true,
                    render: (row) =>
                      row.outstandingMinor > 0 ? (
                        <span className="font-medium text-negative">{money(row.outstandingMinor, currency, locale)}</span>
                      ) : (
                        <span className="subtle">—</span>
                      ),
                  },
                  {
                    key: 'last',
                    header: 'Last purchase',
                    secondary: true,
                    render: (row) => (
                      <span className="text-[13px] muted">
                        {row.lastPurchaseAt ? relativeTime(row.lastPurchaseAt) : 'Never'}
                      </span>
                    ),
                  },
                ]}
              />
              {data && (
                <Pagination
                  page={data.page}
                  totalPages={data.totalPages}
                  total={data.total}
                  pageSize={data.pageSize}
                  onPage={setPage}
                />
              )}
            </>
          )}
        </div>
      </Card>
    </>
  );
}
