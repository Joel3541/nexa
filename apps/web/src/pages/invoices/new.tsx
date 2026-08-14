import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getCurrency } from '@nexa/config/locale';
import type { CustomerView, InvoiceView, Paginated, ProductView } from '@nexa/types';
import { PageHeader } from '@/components/ui/data';
import { useToast } from '@/components/ui/feedback';
import { Button, Card, CardHeader, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/primitives';
import { money } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

interface Line {
  key: string;
  productId?: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
}

const blankLine = (): Line => ({ key: crypto.randomUUID(), name: '', quantity: 1, unitPriceMinor: 0 });

export default function NewInvoicePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { currency, locale, session } = useSession();
  const symbol = getCurrency(currency).symbol;
  const settings = session?.settings;

  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [dueDate, setDueDate] = useState(() => {
    const due = new Date();
    due.setDate(due.getDate() + (settings?.invoiceDueDays ?? 14));
    return due.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState(settings?.invoiceNotes ?? '');

  const { data: customers } = useQuery({
    queryKey: ['invoice-customers'],
    queryFn: () => api.get<Paginated<CustomerView>>('/customers', { pageSize: 200, sort: 'name' }),
  });

  const { data: products } = useQuery({
    queryKey: ['invoice-products'],
    queryFn: () => api.get<Paginated<ProductView>>('/products', { pageSize: 200, active: true }),
  });

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
    if (!settings?.taxEnabled || settings.taxRate <= 0) return { subtotal, tax: 0, total: subtotal };
    const tax = settings.taxInclusive
      ? Math.round((subtotal * settings.taxRate) / (100 + settings.taxRate))
      : Math.round((subtotal * settings.taxRate) / 100);
    return { subtotal, tax, total: settings.taxInclusive ? subtotal : subtotal + tax };
  }, [lines, settings]);

  const update = (key: string, patch: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const create = useMutation({
    mutationFn: (status: 'draft' | 'sent') =>
      api.post<InvoiceView>('/invoices', {
        customerId,
        items: lines
          .filter((line) => line.name.trim() && line.quantity > 0)
          .map((line) => ({
            productId: line.productId,
            name: line.name,
            quantity: line.quantity,
            unitPrice: line.unitPriceMinor,
            discountMinor: 0,
          })),
        discountMinor: 0,
        dueDate: new Date(dueDate).toISOString(),
        notes: notes || undefined,
        status,
      }),
    onSuccess: (invoice) => {
      toast.success('Invoice created', invoice.number);
      navigate(`/app/invoices/${invoice.id}`, { replace: true });
    },
    onError: (error) => toast.error('Could not create invoice', error instanceof ApiRequestError ? error.message : undefined),
  });

  const valid = customerId && lines.some((line) => line.name.trim() && line.unitPriceMinor > 0);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New invoice" subtitle="Save as a draft, or create and send it straight away." />

      <Card className="mb-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer" htmlFor="customer" required>
            <Select id="customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Choose a customer…</option>
              {(customers?.data ?? []).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" htmlFor="due">
            <Input id="due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader
          title="Line items"
          action={
            <Button size="sm" onClick={() => setLines((current) => [...current, blankLine()])}>
              Add line
            </Button>
          }
        />
        <div className="space-y-3">
          {lines.map((line) => (
            <div key={line.key} className="grid gap-2 sm:grid-cols-[1fr_5rem_9rem_2rem] sm:items-end">
              <Field label="Description">
                <Input
                  value={line.name}
                  onChange={(event) => update(line.key, { name: event.target.value })}
                  list="invoice-products"
                  placeholder="Item or service"
                  onBlur={(event) => {
                    // Selecting a catalogue item fills price and links the product.
                    const match = products?.data.find((product) => product.name === event.target.value);
                    if (match) update(line.key, { productId: match.id, unitPriceMinor: match.sellingPriceMinor });
                  }}
                />
              </Field>
              <Field label="Qty">
                <Input
                  type="number"
                  min="1"
                  className="tnum"
                  value={line.quantity}
                  onChange={(event) => update(line.key, { quantity: Number(event.target.value) })}
                />
              </Field>
              <Field label="Unit price">
                <MoneyInput
                  valueMinor={line.unitPriceMinor}
                  onChangeMinor={(value) => update(line.key, { unitPriceMinor: value })}
                  currencySymbol={symbol}
                />
              </Field>
              <button
                onClick={() => setLines((current) => (current.length > 1 ? current.filter((l) => l.key !== line.key) : current))}
                className="mb-2 h-9 text-[13px] subtle hover:text-negative"
                aria-label="Remove line"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <datalist id="invoice-products">
          {(products?.data ?? []).map((product) => (
            <option key={product.id} value={product.name} />
          ))}
        </datalist>

        <dl className="mt-5 space-y-1.5 border-t border-[var(--border)] pt-3.5 text-[13.5px]">
          <div className="flex justify-between">
            <dt className="muted">Subtotal</dt>
            <dd className="tnum">{money(totals.subtotal, currency, locale)}</dd>
          </div>
          {settings?.taxEnabled && (
            <div className="flex justify-between">
              <dt className="muted">
                {settings.taxLabel} ({settings.taxRate}%){settings.taxInclusive ? ' incl.' : ''}
              </dt>
              <dd className="tnum">{money(totals.tax, currency, locale)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-[var(--border)] pt-2 text-[16px] font-semibold">
            <dt>Total</dt>
            <dd className="tnum">{money(totals.total, currency, locale)}</dd>
          </div>
        </dl>
      </Card>

      <Card className="mb-5">
        <Field label="Notes on the invoice" htmlFor="notes">
          <Textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </Field>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => navigate(-1)}>Cancel</Button>
        <Button onClick={() => create.mutate('draft')} loading={create.isPending} disabled={!valid}>
          Save as draft
        </Button>
        <Button variant="primary" onClick={() => create.mutate('sent')} loading={create.isPending} disabled={!valid}>
          Create invoice
        </Button>
      </div>
    </div>
  );
}
