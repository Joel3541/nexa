import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCurrency } from '@nexa/config/locale';
import type { InvoiceView } from '@nexa/types';
import { ArrowLeftIcon } from '@/components/icons';
import { PageHeader } from '@/components/ui/data';
import { ErrorState, Modal, Skeleton, useToast } from '@/components/ui/feedback';
import { Badge, Button, Card, Field, MoneyInput, Select, statusTone } from '@/components/ui/primitives';
import { fullDate, money, titleCase } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

export default function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const { currency, locale, can, session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('mobile_money');

  const { data: invoice, isError, error, refetch } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<InvoiceView>(`/invoices/${id}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const pay = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/payments`, { amountMinor: amount, method }),
    onSuccess: () => {
      setPayOpen(false);
      toast.success('Payment recorded');
      invalidate();
    },
    onError: (error) => toast.error('Could not record payment', error instanceof ApiRequestError ? error.message : undefined),
  });

  const send = useMutation({
    mutationFn: () => api.post<{ message: string; simulated: boolean }>(`/invoices/${id}/send`),
    onSuccess: (result) => {
      // The API tells us plainly whether delivery was real; pass that through
      // verbatim rather than implying the customer received it.
      if (result.simulated) toast.info('Prepared, not delivered', result.message);
      else toast.success('Invoice sent', result.message);
      invalidate();
    },
    onError: (error) => toast.error('Could not send', error instanceof ApiRequestError ? error.message : undefined),
  });

  const markPaid = useMutation({
    mutationFn: () => api.patch(`/invoices/${id}`, { status: 'paid' }),
    onSuccess: () => {
      toast.success('Marked as paid');
      invalidate();
    },
    onError: (error) => toast.error('Could not update', error instanceof ApiRequestError ? error.message : undefined),
  });

  if (isError) {
    return <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />;
  }

  const business = session?.business;

  return (
    <>
      <Link to="/app/invoices" className="mb-3 inline-flex items-center gap-1.5 text-[13px] muted hover:text-[var(--text)] print:hidden">
        <ArrowLeftIcon className="size-4" />
        All invoices
      </Link>

      {!invoice ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title={invoice.number}
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(invoice.status)}>{titleCase(invoice.status)}</Badge>
                <span>Issued {fullDate(invoice.issueDate, locale)}</span>
                <span className={invoice.daysOverdue > 0 ? 'text-negative' : ''}>
                  · Due {fullDate(invoice.dueDate, locale)}
                  {invoice.daysOverdue > 0 && ` (${invoice.daysOverdue} days late)`}
                </span>
              </span>
            }
            actions={
              <div className="print:hidden">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => window.print()}>Download / print</Button>
                  {can('invoices:send') && invoice.customerEmail && (
                    <Button onClick={() => send.mutate()} loading={send.isPending}>
                      Send to customer
                    </Button>
                  )}
                  {invoice.balanceMinor > 0 && can('invoices:write') && (
                    <>
                      <Button onClick={() => markPaid.mutate()} loading={markPaid.isPending}>
                        Mark paid
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => {
                          setAmount(invoice.balanceMinor);
                          setPayOpen(true);
                        }}
                      >
                        Record payment
                      </Button>
                    </>
                  )}
                </div>
              </div>
            }
          />

          {/* Print-ready document. Deliberately plain: it has to survive being
              printed on a shop's black-and-white printer. */}
          <Card className="print:border-0 print:shadow-none">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <h2 className="text-[18px] font-semibold">{business?.name}</h2>
                {business?.addressLine1 && <p className="text-[13px] muted">{business.addressLine1}</p>}
                {business?.city && <p className="text-[13px] muted">{business.city}</p>}
                {business?.phone && <p className="text-[13px] muted">{business.phone}</p>}
                {business?.email && <p className="text-[13px] muted">{business.email}</p>}
              </div>
              <div className="text-right">
                <p className="text-[12px] font-semibold tracking-wide uppercase subtle">Invoice</p>
                <p className="text-[20px] font-semibold">{invoice.number}</p>
                <p className="mt-1 text-[13px] muted">Issued {fullDate(invoice.issueDate, locale)}</p>
                <p className="text-[13px] muted">Due {fullDate(invoice.dueDate, locale)}</p>
              </div>
            </div>

            <div className="mt-6 border-t border-[var(--border)] pt-4">
              <p className="text-[12px] font-semibold tracking-wide uppercase subtle">Bill to</p>
              <Link to={`/app/customers/${invoice.customerId}`} className="text-[15px] font-medium hover:text-accent">
                {invoice.customerName}
              </Link>
              {invoice.customerEmail && <p className="text-[13px] muted">{invoice.customerEmail}</p>}
            </div>

            <table className="mt-6 w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="pb-2 font-semibold">Description</th>
                  <th className="pb-2 text-right font-semibold">Qty</th>
                  <th className="pb-2 text-right font-semibold">Unit price</th>
                  <th className="pb-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr key={item.id} className="border-b border-[var(--border)]">
                    <td className="py-2.5">{item.name}</td>
                    <td className="py-2.5 text-right tnum">{item.quantity}</td>
                    <td className="py-2.5 text-right tnum">{money(item.unitPriceMinor, currency, locale)}</td>
                    <td className="py-2.5 text-right tnum">{money(item.totalMinor, currency, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex justify-end">
              <dl className="w-full max-w-xs space-y-1.5 text-[13.5px]">
                <div className="flex justify-between">
                  <dt className="muted">Subtotal</dt>
                  <dd className="tnum">{money(invoice.subtotalMinor, currency, locale)}</dd>
                </div>
                {invoice.discountMinor > 0 && (
                  <div className="flex justify-between">
                    <dt className="muted">Discount</dt>
                    <dd className="tnum">−{money(invoice.discountMinor, currency, locale)}</dd>
                  </div>
                )}
                {invoice.taxMinor > 0 && (
                  <div className="flex justify-between">
                    <dt className="muted">{session?.settings?.taxLabel ?? 'Tax'}</dt>
                    <dd className="tnum">{money(invoice.taxMinor, currency, locale)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-[var(--border)] pt-2 text-[16px] font-semibold">
                  <dt>Total</dt>
                  <dd className="tnum">{money(invoice.totalMinor, currency, locale)}</dd>
                </div>
                {invoice.paidMinor > 0 && (
                  <div className="flex justify-between">
                    <dt className="muted">Paid</dt>
                    <dd className="tnum text-positive">−{money(invoice.paidMinor, currency, locale)}</dd>
                  </div>
                )}
                <div className="flex justify-between font-semibold">
                  <dt>Balance due</dt>
                  <dd className={`tnum ${invoice.balanceMinor > 0 ? 'text-negative' : 'text-positive'}`}>
                    {money(invoice.balanceMinor, currency, locale)}
                  </dd>
                </div>
              </dl>
            </div>

            {invoice.notes && (
              <p className="mt-6 border-t border-[var(--border)] pt-4 text-[13px] whitespace-pre-wrap muted">
                {invoice.notes}
              </p>
            )}
            {session?.settings?.invoiceFooter && (
              <p className="mt-3 text-[12px] subtle">{session.settings.invoiceFooter}</p>
            )}
          </Card>

          {invoice.payments.length > 0 && (
            <Card className="mt-5 print:hidden">
              <p className="mb-3 text-[15px] font-semibold">Payments</p>
              <ul className="divide-y divide-[var(--border)]">
                {invoice.payments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="text-[14px] font-medium">{titleCase(payment.method)}</p>
                      <p className="text-[12.5px] subtle">{fullDate(payment.receivedAt, locale)}</p>
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
        description={invoice ? `Balance due ${money(invoice.balanceMinor, currency, locale)}` : undefined}
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
