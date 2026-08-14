import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCurrency } from '@nexa/config/locale';
import type { OrderView } from '@nexa/types';
import { ArrowLeftIcon } from '@/components/icons';
import { PageHeader } from '@/components/ui/data';
import { ErrorState, Modal, Skeleton, useToast } from '@/components/ui/feedback';
import { Badge, Button, Card, CardHeader, Field, MoneyInput, Select, statusTone } from '@/components/ui/primitives';
import { dateTime, money, titleCase } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

export default function SaleDetailPage() {
  const { id = '' } = useParams();
  const { currency, locale, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('mobile_money');

  const { data: order, isError, error, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderView>(`/orders/${id}`),
  });

  const pay = useMutation({
    mutationFn: () => api.post(`/orders/${id}/payments`, { amountMinor: amount, method }),
    onSuccess: () => {
      setPayOpen(false);
      toast.success('Payment recorded');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => toast.error('Could not record payment', error instanceof ApiRequestError ? error.message : undefined),
  });

  if (isError) {
    return <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />;
  }

  return (
    <>
      <Link to="/app/sales" className="mb-3 inline-flex items-center gap-1.5 text-[13px] muted hover:text-[var(--text)]">
        <ArrowLeftIcon className="size-4" />
        All sales
      </Link>

      {!order ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title={order.reference}
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(order.paymentStatus)}>{titleCase(order.paymentStatus)}</Badge>
                <Badge tone={statusTone(order.status)}>{titleCase(order.status)}</Badge>
                <span>{dateTime(order.occurredAt, locale)}</span>
                {order.channel && <span>· {titleCase(order.channel)}</span>}
              </span>
            }
            actions={
              order.balanceMinor > 0 &&
              can('orders:write') && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setAmount(order.balanceMinor);
                    setPayOpen(true);
                  }}
                >
                  Record payment
                </Button>
              )
            }
          />

          <Card className="mb-5">
            <CardHeader
              title="Items"
              subtitle={
                order.customerId ? (
                  <Link to={`/app/customers/${order.customerId}`} className="text-accent hover:underline">
                    {order.customerName}
                  </Link>
                ) : (
                  'Walk-in customer'
                )
              }
            />
            <ul className="divide-y divide-[var(--border)]">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">{item.name}</p>
                    <p className="text-[12.5px] subtle tnum">
                      {item.quantity} × {money(item.unitPriceMinor, currency, locale)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[14px] font-semibold tnum">
                    {money(item.totalMinor, currency, locale)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-3.5 text-[13.5px]">
              <div className="flex justify-between">
                <dt className="muted">Subtotal</dt>
                <dd className="tnum">{money(order.subtotalMinor, currency, locale)}</dd>
              </div>
              {order.discountMinor > 0 && (
                <div className="flex justify-between">
                  <dt className="muted">Discount</dt>
                  <dd className="tnum text-negative">−{money(order.discountMinor, currency, locale)}</dd>
                </div>
              )}
              {order.taxMinor > 0 && (
                <div className="flex justify-between">
                  <dt className="muted">Tax</dt>
                  <dd className="tnum">{money(order.taxMinor, currency, locale)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-[var(--border)] pt-2 text-[16px] font-semibold">
                <dt>Total</dt>
                <dd className="tnum">{money(order.totalMinor, currency, locale)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="muted">Paid</dt>
                <dd className="tnum text-positive">{money(order.paidMinor, currency, locale)}</dd>
              </div>
              {order.balanceMinor > 0 && (
                <div className="flex justify-between font-medium">
                  <dt>Balance due</dt>
                  <dd className="tnum text-negative">{money(order.balanceMinor, currency, locale)}</dd>
                </div>
              )}
            </dl>
          </Card>

          {order.payments.length > 0 && (
            <Card>
              <CardHeader title="Payments" />
              <ul className="divide-y divide-[var(--border)]">
                {order.payments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="text-[14px] font-medium">{titleCase(payment.method)}</p>
                      <p className="text-[12.5px] subtle">{dateTime(payment.receivedAt, locale)}</p>
                    </div>
                    <span className="text-[14px] font-semibold tnum text-positive">
                      {money(payment.amountMinor, currency, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Record a payment"
        description={order ? `Balance due ${money(order.balanceMinor, currency, locale)}` : undefined}
        size="sm"
        footer={
          <>
            <Button onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => pay.mutate()} loading={pay.isPending} disabled={amount <= 0}>
              Record payment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Amount" htmlFor="amount">
            <MoneyInput
              id="amount"
              valueMinor={amount}
              onChangeMinor={setAmount}
              currencySymbol={getCurrency(currency).symbol}
              autoFocus
            />
          </Field>
          <Field label="Method" htmlFor="method">
            <Select id="method" value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="mobile_money">Mobile money</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cheque">Cheque</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </>
  );
}
