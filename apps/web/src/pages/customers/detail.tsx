import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CustomerTimelineEntry, CustomerView } from '@nexa/types';
import { ArrowLeftIcon } from '@/components/icons';
import { PageHeader, StatTile } from '@/components/ui/data';
import { ConfirmDialog, ErrorState, Skeleton, useToast } from '@/components/ui/feedback';
import { Avatar, Badge, Button, Card, CardHeader, Textarea, cx } from '@/components/ui/primitives';
import { dateTime, money, relativeTime, titleCase } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

export default function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { currency, locale, can } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const customerQuery = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<CustomerView>(`/customers/${id}`),
  });

  const timelineQuery = useQuery({
    queryKey: ['customer-timeline', id],
    queryFn: () => api.get<CustomerTimelineEntry[]>(`/customers/${id}/timeline`),
  });

  const addNote = useMutation({
    mutationFn: () => api.post(`/customers/${id}/notes`, { body: note }),
    onSuccess: () => {
      setNote('');
      toast.success('Note added');
      queryClient.invalidateQueries({ queryKey: ['customer-timeline', id] });
    },
    onError: (error) => toast.error('Could not add note', error instanceof ApiRequestError ? error.message : undefined),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/customers/${id}`),
    onSuccess: () => {
      toast.success('Customer deleted');
      navigate('/app/customers', { replace: true });
    },
    onError: (error) => {
      setConfirmDelete(false);
      toast.error('Could not delete', error instanceof ApiRequestError ? error.message : undefined);
    },
  });

  if (customerQuery.isError) {
    return (
      <ErrorState
        message={customerQuery.error instanceof Error ? customerQuery.error.message : undefined}
        onRetry={() => customerQuery.refetch()}
      />
    );
  }

  const customer = customerQuery.data;

  return (
    <>
      <Link to="/app/customers" className="mb-3 inline-flex items-center gap-1.5 text-[13px] muted hover:text-[var(--text)]">
        <ArrowLeftIcon className="size-4" />
        All customers
      </Link>

      {!customer ? (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <PageHeader
            title={customer.name}
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                {customer.phone && <span>{customer.phone}</span>}
                {customer.email && <span>· {customer.email}</span>}
                {customer.city && <span>· {customer.city}</span>}
              </span>
            }
            actions={
              <>
                <Link to={`/app/sales/new?customerId=${customer.id}`}>
                  <Button variant="primary">New sale</Button>
                </Link>
                <Link to={`/app/invoices/new?customerId=${customer.id}`}>
                  <Button>New invoice</Button>
                </Link>
                {can('customers:delete') && (
                  <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                )}
              </>
            }
          />

          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Avatar name={customer.name} size={40} />
            <Badge tone={customer.status === 'active' ? 'success' : customer.status === 'blocked' ? 'danger' : 'neutral'}>
              {titleCase(customer.status)}
            </Badge>
            {customer.segments.map((segment) => (
              <Badge key={segment} tone={segment === 'inactive' ? 'warning' : segment === 'owes_money' ? 'danger' : segment === 'vip' ? 'brand' : 'neutral'}>
                {titleCase(segment)}
              </Badge>
            ))}
            {customer.tags.map((tag) => (
              <Badge key={tag} tone="info">
                #{tag}
              </Badge>
            ))}
          </div>

          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Lifetime value" value={money(customer.totalSpentMinor, currency, locale)} />
            <StatTile label="Orders" value={String(customer.orderCount)} hint={`Average ${money(customer.averageOrderMinor, currency, locale)}`} />
            <StatTile
              label="Outstanding"
              value={money(customer.outstandingMinor, currency, locale)}
              tone={customer.outstandingMinor > 0 ? 'negative' : 'neutral'}
            />
            <StatTile
              label="Last purchase"
              value={customer.lastPurchaseAt ? relativeTime(customer.lastPurchaseAt) : 'Never'}
              hint={`Customer since ${new Date(customer.createdAt).toLocaleDateString(locale)}`}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <Card>
              <CardHeader title="Timeline" subtitle="Everything that has happened with this customer" />
              {timelineQuery.isLoading ? (
                <Skeleton className="h-48" />
              ) : (timelineQuery.data ?? []).length === 0 ? (
                <p className="py-8 text-center text-[13.5px] muted">Nothing recorded yet.</p>
              ) : (
                <ol className="relative space-y-4 border-l border-[var(--border)] pl-5">
                  {timelineQuery.data!.map((entry) => (
                    <li key={entry.id} className="relative">
                      <span
                        className={cx(
                          'absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full ring-4 ring-[var(--surface)]',
                          entry.type === 'payment' ? 'bg-emerald-500' : entry.type === 'invoice' ? 'bg-amber-500' : entry.type === 'order' ? 'bg-brand-500' : 'bg-ink-300',
                        )}
                      />
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[14px] font-medium">{entry.title}</p>
                        {entry.amountMinor !== null && (
                          <span className="shrink-0 text-[13.5px] font-semibold tnum">
                            {money(entry.amountMinor, currency, locale)}
                          </span>
                        )}
                      </div>
                      {entry.description && <p className="mt-0.5 text-[13px] muted">{entry.description}</p>}
                      <p className="mt-0.5 text-[11.5px] subtle">{dateTime(entry.occurredAt, locale)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <div className="space-y-5">
              <Card>
                <CardHeader title="Add a note" />
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Prefers WhatsApp. Asked about the gift box for December."
                  rows={4}
                />
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-2.5"
                  disabled={!note.trim()}
                  loading={addNote.isPending}
                  onClick={() => addNote.mutate()}
                >
                  Save note
                </Button>
              </Card>

              {customer.notes && (
                <Card>
                  <CardHeader title="Profile notes" />
                  <p className="text-[13.5px] whitespace-pre-wrap muted">{customer.notes}</p>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Delete this customer?"
        confirmLabel="Delete customer"
        message={
          <>
            This removes {customer?.name} and their notes. Past sales stay in your records for accounting.
            Customers with unpaid invoices cannot be deleted.
          </>
        }
      />
    </>
  );
}
