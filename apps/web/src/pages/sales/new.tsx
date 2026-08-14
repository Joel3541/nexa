import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getCurrency } from '@nexa/config/locale';
import type { CustomerView, OrderView, Paginated, ProductView } from '@nexa/types';
import { PlusIcon } from '@/components/icons';
import { PageHeader } from '@/components/ui/data';
import { useToast } from '@/components/ui/feedback';
import { Badge, Button, Card, CardHeader, Field, Input, MoneyInput, Select, cx } from '@/components/ui/primitives';
import { money } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

interface Line {
  productId: string;
  name: string;
  unitPriceMinor: number;
  quantity: number;
  available: number;
  tracksStock: boolean;
}

/**
 * Point of sale.
 *
 * Totals are recomputed here for immediate feedback, but the server recomputes
 * them authoritatively on submit — the browser's arithmetic never decides what
 * a customer is charged.
 */
export default function NewSalePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { currency, locale, session } = useSession();
  const symbol = getCurrency(currency).symbol;

  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [lines, setLines] = useState<Line[]>([]);
  const [discountMinor, setDiscountMinor] = useState(0);
  const [paid, setPaid] = useState(true);
  const [method, setMethod] = useState('mobile_money');
  const [search, setSearch] = useState('');

  const { data: products } = useQuery({
    queryKey: ['pos-products', search],
    queryFn: () => api.get<Paginated<ProductView>>('/products', { pageSize: 30, q: search || undefined, active: true }),
  });

  const { data: customers } = useQuery({
    queryKey: ['pos-customers'],
    queryFn: () => api.get<Paginated<CustomerView>>('/customers', { pageSize: 100, sort: 'name' }),
  });

  const settings = session?.settings;

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
    const afterDiscount = Math.max(0, subtotal - discountMinor);
    if (!settings?.taxEnabled || settings.taxRate <= 0) {
      return { subtotal, tax: 0, total: afterDiscount };
    }
    const tax = settings.taxInclusive
      ? Math.round((afterDiscount * settings.taxRate) / (100 + settings.taxRate))
      : Math.round((afterDiscount * settings.taxRate) / 100);
    return { subtotal, tax, total: settings.taxInclusive ? afterDiscount : afterDiscount + tax };
  }, [lines, discountMinor, settings]);

  function addProduct(product: ProductView) {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          unitPriceMinor: product.sellingPriceMinor,
          quantity: 1,
          available: product.quantity,
          tracksStock: product.trackInventory && product.kind === 'physical',
        },
      ];
    });
  }

  const create = useMutation({
    mutationFn: () =>
      api.post<OrderView>('/orders', {
        customerId: customerId || undefined,
        items: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPriceMinor,
          discountMinor: 0,
        })),
        discountMinor,
        status: 'confirmed',
        channel: 'walk-in',
        ...(paid ? { payment: { amountMinor: totals.total, method } } : {}),
      }),
    onSuccess: (order) => {
      toast.success('Sale recorded', `${order.reference} · ${money(order.totalMinor, currency, locale)}`);
      navigate(`/app/sales/${order.id}`, { replace: true });
    },
    onError: (error) =>
      toast.error('Could not record the sale', error instanceof ApiRequestError ? error.message : undefined),
  });

  const overStock = lines.some((line) => line.tracksStock && line.quantity > line.available);

  return (
    <>
      <PageHeader title="Record a sale" subtitle="Add items, choose a customer, take payment." />

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card padded={false}>
          <div className="p-4">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search products and services…"
              aria-label="Search products"
            />
          </div>
          <div className="grid max-h-[26rem] grid-cols-2 gap-2 overflow-y-auto p-4 pt-0 sm:grid-cols-3">
            {(products?.data ?? []).map((product) => {
              const out = product.trackInventory && product.kind === 'physical' && product.quantity <= 0;
              return (
                <button
                  key={product.id}
                  onClick={() => addProduct(product)}
                  disabled={out}
                  className={cx(
                    'rounded-xl border p-3 text-left transition-colors',
                    out
                      ? 'cursor-not-allowed border-[var(--border)] opacity-50'
                      : 'border-[var(--border-strong)] hover:border-brand-400 hover:bg-brand-50/50 dark:hover:bg-brand-900/20',
                  )}
                >
                  <p className="line-clamp-2 text-[13px] font-medium">{product.name}</p>
                  <p className="mt-1 text-[13px] font-semibold tnum">
                    {money(product.sellingPriceMinor, currency, locale)}
                  </p>
                  <p className="mt-0.5 text-[11.5px] subtle">
                    {product.kind === 'service' ? 'Service' : out ? 'Out of stock' : `${product.quantity} in stock`}
                  </p>
                </button>
              );
            })}
            {products?.data.length === 0 && (
              <p className="col-span-full py-8 text-center text-[13.5px] muted">No products match that search.</p>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Cart" subtitle={`${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`} />
            {lines.length === 0 ? (
              <p className="py-8 text-center text-[13.5px] muted">Tap a product to add it.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {lines.map((line) => (
                  <li key={line.productId} className="py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-[13.5px] font-medium">{line.name}</p>
                      <button
                        onClick={() => setLines((current) => current.filter((l) => l.productId !== line.productId))}
                        className="shrink-0 text-[12px] subtle hover:text-negative"
                        aria-label={`Remove ${line.name}`}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex items-center rounded-lg border border-[var(--border-strong)]">
                        <button
                          className="px-2.5 py-1 text-[15px] hover:bg-[var(--surface-muted)]"
                          onClick={() =>
                            setLines((current) =>
                              current
                                .map((l) => (l.productId === line.productId ? { ...l, quantity: l.quantity - 1 } : l))
                                .filter((l) => l.quantity > 0),
                            )
                          }
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-[13px] tnum">{line.quantity}</span>
                        <button
                          className="px-2.5 py-1 text-[15px] hover:bg-[var(--surface-muted)]"
                          onClick={() =>
                            setLines((current) =>
                              current.map((l) => (l.productId === line.productId ? { ...l, quantity: l.quantity + 1 } : l)),
                            )
                          }
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <span className="ml-auto text-[13.5px] font-semibold tnum">
                        {money(line.unitPriceMinor * line.quantity, currency, locale)}
                      </span>
                    </div>
                    {line.tracksStock && line.quantity > line.available && (
                      <p className="mt-1 text-[12px] text-negative">Only {line.available} in stock.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <Field label="Customer" htmlFor="customer" hint="Optional — leave blank for a walk-in">
              <Select id="customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                <option value="">Walk-in customer</option>
                {(customers?.data ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Discount" htmlFor="discount" className="mt-4">
              <MoneyInput
                id="discount"
                valueMinor={discountMinor}
                onChangeMinor={setDiscountMinor}
                currencySymbol={symbol}
              />
            </Field>

            <dl className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-3.5 text-[13.5px]">
              <div className="flex justify-between">
                <dt className="muted">Subtotal</dt>
                <dd className="tnum">{money(totals.subtotal, currency, locale)}</dd>
              </div>
              {discountMinor > 0 && (
                <div className="flex justify-between">
                  <dt className="muted">Discount</dt>
                  <dd className="tnum text-negative">−{money(discountMinor, currency, locale)}</dd>
                </div>
              )}
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

            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setPaid(true)}
                  className={cx(
                    'flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium',
                    paid ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30' : 'border-[var(--border-strong)]',
                  )}
                >
                  Paid now
                </button>
                <button
                  onClick={() => setPaid(false)}
                  className={cx(
                    'flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium',
                    !paid ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30' : 'border-[var(--border-strong)]',
                  )}
                >
                  On account
                </button>
              </div>

              {paid ? (
                <Select value={method} onChange={(event) => setMethod(event.target.value)} aria-label="Payment method">
                  <option value="mobile_money">Mobile money</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                </Select>
              ) : (
                <p className="text-[12.5px] muted">
                  This will be recorded as unpaid. {customerId ? 'You can invoice it afterwards.' : 'Choose a customer to invoice it later.'}
                </p>
              )}
            </div>

            <Button
              variant="primary"
              size="lg"
              className="mt-4 w-full justify-center"
              disabled={lines.length === 0 || overStock}
              loading={create.isPending}
              onClick={() => create.mutate()}
              icon={<PlusIcon className="size-4" />}
            >
              Complete sale · {money(totals.total, currency, locale)}
            </Button>
            {overStock && (
              <Badge tone="danger" className="mt-2">
                Reduce quantities — some items exceed available stock
              </Badge>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
