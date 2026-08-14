import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Paginated, ProductView } from '@nexa/types';
import { BoxIcon, PlusIcon } from '@/components/icons';
import { DataTable, PageHeader, Pagination, Tabs } from '@/components/ui/data';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Badge, Button, Card, Input } from '@/components/ui/primitives';
import { money } from '@/lib/format';
import { api } from '@/lib/api';
import { useSession } from '@/store/session';

type Filter = 'all' | 'physical' | 'service' | 'low';

export default function ProductsPage() {
  const { currency, locale, can } = useSession();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>(params.get('lowStock') ? 'low' : 'all');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['products', { page, search, filter }],
    queryFn: () =>
      api.get<Paginated<ProductView>>('/products', {
        page,
        pageSize: 25,
        q: search || undefined,
        kind: filter === 'physical' || filter === 'service' ? filter : undefined,
        lowStockOnly: filter === 'low' ? true : undefined,
        sort: filter === 'low' ? 'stock' : 'name',
      }),
  });

  function changeFilter(next: Filter) {
    setFilter(next);
    setPage(1);
    const query = new URLSearchParams(params);
    if (next === 'low') query.set('lowStock', '1');
    else query.delete('lowStock');
    setParams(query);
  }

  return (
    <>
      <PageHeader
        title="Products & services"
        subtitle={data ? `${data.total} items` : undefined}
        actions={
          can('products:write') && (
            <Link to="/app/products/new">
              <Button variant="primary" icon={<PlusIcon className="size-4" />}>
                Add item
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
            placeholder="Search by name or SKU…"
            className="max-w-xs"
            aria-label="Search products"
          />
        </div>

        <Tabs
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'physical', label: 'Products' },
            { id: 'service', label: 'Services' },
            { id: 'low', label: 'Low stock' },
          ]}
          active={filter}
          onChange={changeFilter}
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
                onRowHref={(row) => `/app/products/${row.id}`}
                empty={
                  <EmptyState
                    icon={<BoxIcon />}
                    title={filter === 'low' ? 'Nothing is running low' : 'No products yet'}
                    message={
                      filter === 'low'
                        ? 'Every tracked item is above its minimum stock level.'
                        : 'Add what you sell — physical products with stock, or services with a duration.'
                    }
                    action={
                      can('products:write') && filter !== 'low' ? (
                        <Link to="/app/products/new">
                          <Button variant="primary">Add item</Button>
                        </Link>
                      ) : undefined
                    }
                  />
                }
                columns={[
                  {
                    key: 'name',
                    header: 'Item',
                    render: (row) => (
                      <span className="min-w-0">
                        <span className="block truncate">{row.name}</span>
                        <span className="block truncate text-[12px] font-normal subtle">
                          {row.sku ?? row.categoryName ?? (row.kind === 'service' ? 'Service' : 'Product')}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: 'price',
                    header: 'Price',
                    numeric: true,
                    render: (row) => money(row.sellingPriceMinor, currency, locale),
                  },
                  {
                    key: 'margin',
                    header: 'Margin',
                    numeric: true,
                    secondary: true,
                    render: (row) =>
                      row.marginPercent === null ? (
                        <span className="subtle">—</span>
                      ) : (
                        <span className={row.marginPercent < 20 ? 'text-amber-600' : ''}>
                          {Math.round(row.marginPercent)}%
                        </span>
                      ),
                  },
                  {
                    key: 'stock',
                    header: 'Stock',
                    numeric: true,
                    render: (row) =>
                      row.kind === 'service' || !row.trackInventory ? (
                        <span className="subtle">n/a</span>
                      ) : (
                        <span className={row.isLowStock ? 'font-medium text-red-600' : ''}>{row.quantity}</span>
                      ),
                  },
                  {
                    key: 'velocity',
                    header: '30-day sales',
                    numeric: true,
                    secondary: true,
                    render: (row) => row.unitsSold30d,
                  },
                  {
                    key: 'status',
                    header: 'Cover',
                    secondary: true,
                    render: (row) =>
                      row.kind === 'service' ? (
                        <Badge>Service</Badge>
                      ) : row.quantity === 0 ? (
                        <Badge tone="danger">Out of stock</Badge>
                      ) : row.daysOfStockRemaining === null ? (
                        <span className="text-[12.5px] subtle">No recent sales</span>
                      ) : (
                        <Badge tone={row.daysOfStockRemaining <= 10 ? 'warning' : 'neutral'}>
                          ~{row.daysOfStockRemaining} days
                        </Badge>
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
