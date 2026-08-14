import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCurrency } from '@nexa/config/locale';
import type { ExpenseView, Paginated } from '@nexa/types';
import { PlusIcon, WalletIcon } from '@/components/icons';
import { DataTable, PageHeader, Pagination, StatTile } from '@/components/ui/data';
import { ConfirmDialog, EmptyState, ErrorState, Modal, TableSkeleton, useToast } from '@/components/ui/feedback';
import { Button, Card, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/primitives';
import { fullDate, money, titleCase } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

export default function ExpensesPage() {
  const { currency, locale, can } = useSession();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(params.get('new') === '1');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    amountMinor: 0,
    categoryName: '',
    vendor: '',
    description: '',
    paymentMethod: 'cash',
    spentAt: new Date().toISOString().slice(0, 10),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['expenses', { page, search }],
    queryFn: () => api.get<Paginated<ExpenseView> & { totalMinor: number }>('/expenses', { page, pageSize: 25, q: search || undefined }),
  });

  const { data: categories } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/expenses/categories'),
  });

  function closeModal() {
    setOpen(false);
    const query = new URLSearchParams(params);
    query.delete('new');
    setParams(query);
  }

  const create = useMutation({
    mutationFn: () =>
      api.post('/expenses', {
        amountMinor: form.amountMinor,
        categoryName: form.categoryName || undefined,
        vendor: form.vendor || undefined,
        description: form.description || undefined,
        paymentMethod: form.paymentMethod,
        spentAt: new Date(form.spentAt).toISOString(),
      }),
    onSuccess: () => {
      closeModal();
      setForm((current) => ({ ...current, amountMinor: 0, vendor: '', description: '' }));
      toast.success('Expense recorded');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => toast.error('Could not save', error instanceof ApiRequestError ? error.message : undefined),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      setDeleteId(null);
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (error) => toast.error('Could not delete', error instanceof ApiRequestError ? error.message : undefined),
  });

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle={data ? `${data.total} recorded` : undefined}
        actions={
          can('expenses:write') && (
            <Button variant="primary" icon={<PlusIcon className="size-4" />} onClick={() => setOpen(true)}>
              Record expense
            </Button>
          )
        }
      />

      {data && (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <StatTile label="Total on this page" value={money(data.totalMinor, currency, locale)} />
          <StatTile label="Entries" value={String(data.total)} />
          <StatTile
            label="Average"
            value={data.total > 0 ? money(Math.round(data.totalMinor / Math.max(data.data.length, 1)), currency, locale) : '—'}
          />
        </div>
      )}

      <Card padded={false}>
        <div className="p-4">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by vendor or description…"
            className="max-w-xs"
            aria-label="Search expenses"
          />
        </div>

        <div className="p-4 pt-0">
          {isError ? (
            <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
          ) : isLoading ? (
            <TableSkeleton rows={6} columns={4} />
          ) : (
            <>
              <DataTable
                rows={data?.data ?? []}
                empty={
                  <EmptyState
                    icon={<WalletIcon />}
                    title="No expenses recorded"
                    message="Track what you spend so NEXA can show you real profit, not just revenue."
                    action={
                      can('expenses:write') ? (
                        <Button variant="primary" onClick={() => setOpen(true)}>
                          Record expense
                        </Button>
                      ) : undefined
                    }
                  />
                }
                columns={[
                  {
                    key: 'vendor',
                    header: 'Expense',
                    render: (row) => (
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{row.vendor ?? row.description ?? 'Expense'}</span>
                        {row.vendor && row.description && (
                          <span className="block truncate text-[12px] font-normal subtle">{row.description}</span>
                        )}
                      </span>
                    ),
                  },
                  { key: 'category', header: 'Category', secondary: true, render: (row) => row.categoryName ?? <span className="subtle">Uncategorised</span> },
                  { key: 'method', header: 'Paid by', secondary: true, render: (row) => titleCase(row.paymentMethod) },
                  { key: 'date', header: 'Date', secondary: true, render: (row) => <span className="text-[13px] muted">{fullDate(row.spentAt, locale)}</span> },
                  { key: 'amount', header: 'Amount', numeric: true, render: (row) => <span className="font-medium">{money(row.amountMinor, currency, locale)}</span> },
                  {
                    key: 'actions',
                    header: '',
                    numeric: true,
                    render: (row) =>
                      can('expenses:write') ? (
                        <button onClick={() => setDeleteId(row.id)} className="text-[12.5px] subtle hover:text-red-600">
                          Delete
                        </button>
                      ) : null,
                  },
                ]}
              />
              {data && (
                <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} />
              )}
            </>
          )}
        </div>
      </Card>

      <Modal
        open={open}
        onClose={closeModal}
        title="Record an expense"
        footer={
          <>
            <Button onClick={closeModal}>Cancel</Button>
            <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={form.amountMinor <= 0}>
              Save expense
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Amount" htmlFor="amount" required>
            <MoneyInput
              id="amount"
              valueMinor={form.amountMinor}
              onChangeMinor={(value) => setForm((current) => ({ ...current, amountMinor: value }))}
              currencySymbol={getCurrency(currency).symbol}
              autoFocus
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="category">
              <Input
                id="category"
                list="expense-categories"
                value={form.categoryName}
                onChange={(event) => setForm((current) => ({ ...current, categoryName: event.target.value }))}
                placeholder="Rent, Marketing…"
              />
              <datalist id="expense-categories">
                {(categories ?? []).map((category) => (
                  <option key={category.id} value={category.name} />
                ))}
              </datalist>
            </Field>
            <Field label="Vendor" htmlFor="vendor">
              <Input id="vendor" value={form.vendor} onChange={(event) => setForm((current) => ({ ...current, vendor: event.target.value }))} />
            </Field>
            <Field label="Paid by" htmlFor="method">
              <Select
                id="method"
                value={form.paymentMethod}
                onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))}
              >
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="card">Card</option>
                <option value="cheque">Cheque</option>
              </Select>
            </Field>
            <Field label="Date" htmlFor="spentAt">
              <Input
                id="spentAt"
                type="date"
                value={form.spentAt}
                onChange={(event) => setForm((current) => ({ ...current, spentAt: event.target.value }))}
              />
            </Field>
          </div>
          <Field label="Description" htmlFor="description">
            <Textarea
              id="description"
              rows={2}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && remove.mutate(deleteId)}
        loading={remove.isPending}
        title="Delete this expense?"
        message="This removes it from your profit calculation. The action is logged in your audit trail."
        confirmLabel="Delete expense"
      />
    </>
  );
}
