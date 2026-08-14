import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { OrderView, Paginated } from '@nexa/types';
import { CartIcon, PlusIcon } from '@/components/icons';
import { DataTable, PageHeader, Pagination, Tabs } from '@/components/ui/data';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Badge, Button, Card, Input, statusTone } from '@/components/ui/primitives';
import { dateTime, money, titleCase } from '@/lib/format';
import { api } from '@/lib/api';
import { useSession } from '@/store/session';

export default function SalesPage() {
  const { currency, locale, can } = useSession();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['orders', { page, search, paymentStatus }],
    queryFn: () =>
      api.get<Paginated<OrderView>>('/orders', {
        page,
        pageSize: 25,
        q: search || undefined,
        paymentStatus: paymentStatus || undefined,
      }),
  });

  return (
    <>
      <PageHeader
        title="Sales"
        subtitle={data ? `${data.total} recorded` : undefined}
        actions={
          can('orders:write') && (
            <Link to="/app/sales/new">
              <Button variant="primary" icon={<PlusIcon className="size-4" />}>
                Record a sale
              </Button>
            </Link>
          )
        }
      />

      <Card padded={false}>
        <div className="p-4">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by reference or customer…"
            className="max-w-xs"
            aria-label="Search sales"
          />
        </div>

        <Tabs
          tabs={[
            { id: '', label: 'All' },
            { id: 'paid', label: 'Paid' },
            { id: 'partial', label: 'Part paid' },
            { id: 'unpaid', label: 'Unpaid' },
          ]}
          active={paymentStatus}
          onChange={(next) => {
            setPaymentStatus(next);
            setPage(1);
          }}
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
                onRowHref={(row) => `/app/sales/${row.id}`}
                empty={
                  <EmptyState
                    icon={<CartIcon />}
                    title="No sales yet"
                    message="Record your first sale and NEXA starts building your revenue picture."
                    action={
                      can('orders:write') ? (
                        <Link to="/app/sales/new">
                          <Button variant="primary">Record a sale</Button>
                        </Link>
                      ) : undefined
                    }
                  />
                }
                columns={[
                  { key: 'ref', header: 'Reference', render: (row) => row.reference },
                  {
                    key: 'customer',
                    header: 'Customer',
                    render: (row) => row.customerName ?? <span className="subtle">Walk-in</span>,
                  },
                  {
                    key: 'items',
                    header: 'Items',
                    numeric: true,
                    secondary: true,
                    render: (row) => row.items.reduce((sum, item) => sum + item.quantity, 0),
                  },
                  {
                    key: 'date',
                    header: 'Date',
                    secondary: true,
                    render: (row) => <span className="text-[13px] muted">{dateTime(row.occurredAt, locale)}</span>,
                  },
                  {
                    key: 'status',
                    header: 'Payment',
                    render: (row) => (
                      <Badge tone={statusTone(row.paymentStatus)}>{titleCase(row.paymentStatus)}</Badge>
                    ),
                  },
                  {
                    key: 'total',
                    header: 'Total',
                    numeric: true,
                    render: (row) => <span className="font-medium">{money(row.totalMinor, currency, locale)}</span>,
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
