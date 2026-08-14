import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { InvoiceView, Paginated } from '@nexa/types';
import { InvoiceIcon, PlusIcon } from '@/components/icons';
import { DataTable, PageHeader, Pagination, Tabs } from '@/components/ui/data';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Badge, Button, Card, Input, statusTone } from '@/components/ui/primitives';
import { fullDate, money, titleCase } from '@/lib/format';
import { api } from '@/lib/api';
import { useSession } from '@/store/session';

export default function InvoicesPage() {
  const { currency, locale, can } = useSession();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('overdue') ? 'overdue' : '');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['invoices', { page, search, status }],
    queryFn: () =>
      api.get<Paginated<InvoiceView>>('/invoices', {
        page,
        pageSize: 25,
        q: search || undefined,
        status: status || undefined,
      }),
  });

  function changeStatus(next: string) {
    setStatus(next);
    setPage(1);
    const query = new URLSearchParams(params);
    if (next === 'overdue') query.set('overdue', '1');
    else query.delete('overdue');
    setParams(query);
  }

  const outstanding = (data?.data ?? []).reduce((sum, invoice) => sum + invoice.balanceMinor, 0);

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={data ? `${data.total} invoices · ${money(outstanding, currency, locale)} outstanding on this page` : undefined}
        actions={
          can('invoices:write') && (
            <Link to="/app/invoices/new">
              <Button variant="primary" icon={<PlusIcon className="size-4" />}>
                New invoice
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
            placeholder="Search by number or customer…"
            className="max-w-xs"
            aria-label="Search invoices"
          />
        </div>

        <Tabs
          tabs={[
            { id: '', label: 'All' },
            { id: 'overdue', label: 'Overdue' },
            { id: 'unpaid', label: 'Unpaid' },
            { id: 'draft', label: 'Drafts' },
            { id: 'paid', label: 'Paid' },
          ]}
          active={status}
          onChange={changeStatus}
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
                onRowHref={(row) => `/app/invoices/${row.id}`}
                empty={
                  <EmptyState
                    icon={<InvoiceIcon />}
                    title={status === 'overdue' ? 'Nothing is overdue' : 'No invoices yet'}
                    message={
                      status === 'overdue'
                        ? 'Every invoice is still within its payment terms.'
                        : 'Create an invoice to bill a customer and track what you are owed.'
                    }
                    action={
                      can('invoices:write') && status !== 'overdue' ? (
                        <Link to="/app/invoices/new">
                          <Button variant="primary">New invoice</Button>
                        </Link>
                      ) : undefined
                    }
                  />
                }
                columns={[
                  { key: 'number', header: 'Invoice', render: (row) => row.number },
                  { key: 'customer', header: 'Customer', render: (row) => row.customerName },
                  {
                    key: 'due',
                    header: 'Due',
                    secondary: true,
                    render: (row) => (
                      <span className={row.daysOverdue > 0 ? 'text-red-600' : 'muted'}>
                        {fullDate(row.dueDate, locale)}
                        {row.daysOverdue > 0 && ` · ${row.daysOverdue}d late`}
                      </span>
                    ),
                  },
                  { key: 'status', header: 'Status', render: (row) => <Badge tone={statusTone(row.status)}>{titleCase(row.status)}</Badge> },
                  {
                    key: 'total',
                    header: 'Total',
                    numeric: true,
                    secondary: true,
                    render: (row) => money(row.totalMinor, currency, locale),
                  },
                  {
                    key: 'balance',
                    header: 'Due',
                    numeric: true,
                    render: (row) =>
                      row.balanceMinor > 0 ? (
                        <span className="font-medium text-red-600">{money(row.balanceMinor, currency, locale)}</span>
                      ) : (
                        <span className="text-emerald-600">Paid</span>
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
