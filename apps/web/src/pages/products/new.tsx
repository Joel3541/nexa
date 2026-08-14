import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProductView } from '@nexa/types';
import { PageHeader } from '@/components/ui/data';
import { useToast } from '@/components/ui/feedback';
import { Button, Card, Field, Input, MoneyInput, Select, Textarea, cx } from '@/components/ui/primitives';
import { getCurrency } from '@nexa/config/locale';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

export default function NewProductPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { currency, locale } = useSession();
  const symbol = getCurrency(currency).symbol;
  const [fields, setFields] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<'physical' | 'service'>('physical');
  const [form, setForm] = useState({
    name: '',
    sku: '',
    categoryName: '',
    description: '',
    supplier: '',
    costPrice: 0,
    sellingPrice: 0,
    quantity: 0,
    minStock: 5,
    durationMinutes: 60,
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const margin =
    form.sellingPrice > 0 ? Math.round(((form.sellingPrice - form.costPrice) / form.sellingPrice) * 100) : null;

  const create = useMutation({
    mutationFn: () =>
      api.post<ProductView>('/products', {
        name: form.name,
        kind,
        sku: form.sku || undefined,
        categoryName: form.categoryName || undefined,
        description: form.description || undefined,
        supplier: kind === 'physical' ? form.supplier || undefined : undefined,
        costPrice: form.costPrice,
        sellingPrice: form.sellingPrice,
        quantity: kind === 'physical' ? form.quantity : 0,
        minStock: kind === 'physical' ? form.minStock : 0,
        durationMinutes: kind === 'service' ? form.durationMinutes : undefined,
        trackInventory: kind === 'physical',
      }),
    onSuccess: (product) => {
      toast.success('Item added', product.name);
      navigate(`/app/products/${product.id}`, { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        setFields(error.fields ?? {});
        toast.error('Could not add item', error.message);
      }
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setFields({});
    create.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Add a product or service" />
      <Card>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-2">
            {(['physical', 'service'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                aria-pressed={kind === option}
                className={cx(
                  'rounded-xl border p-3.5 text-left transition-colors',
                  kind === option
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                    : 'border-[var(--border-strong)] hover:bg-[var(--surface-muted)]',
                )}
              >
                <span className="block text-[14px] font-semibold">
                  {option === 'physical' ? 'Physical product' : 'Service'}
                </span>
                <span className="mt-0.5 block text-[12.5px] muted">
                  {option === 'physical' ? 'Tracks stock levels' : 'Has a duration, no stock'}
                </span>
              </button>
            ))}
          </div>

          <Field label="Name" htmlFor="name" required error={fields.name}>
            <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus invalid={Boolean(fields.name)} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Selling price" htmlFor="sellingPrice" required error={fields.sellingPrice}>
              <MoneyInput
                id="sellingPrice"
                valueMinor={form.sellingPrice}
                onChangeMinor={(value) => set('sellingPrice', value)}
                currencySymbol={symbol}
              />
            </Field>
            <Field
              label="Cost price"
              htmlFor="costPrice"
              hint={margin !== null ? `Margin: ${margin}%` : 'What you pay for it'}
            >
              <MoneyInput
                id="costPrice"
                valueMinor={form.costPrice}
                onChangeMinor={(value) => set('costPrice', value)}
                currencySymbol={symbol}
              />
            </Field>

            {kind === 'physical' ? (
              <>
                <Field label="Opening stock" htmlFor="quantity">
                  <Input
                    id="quantity"
                    type="number"
                    min="0"
                    className="tnum"
                    value={form.quantity}
                    onChange={(e) => set('quantity', Number(e.target.value))}
                  />
                </Field>
                <Field label="Minimum stock" htmlFor="minStock" hint="We'll warn you below this">
                  <Input
                    id="minStock"
                    type="number"
                    min="0"
                    className="tnum"
                    value={form.minStock}
                    onChange={(e) => set('minStock', Number(e.target.value))}
                  />
                </Field>
                <Field label="SKU" htmlFor="sku" error={fields.sku}>
                  <Input id="sku" value={form.sku} onChange={(e) => set('sku', e.target.value)} invalid={Boolean(fields.sku)} />
                </Field>
                <Field label="Supplier" htmlFor="supplier">
                  <Input id="supplier" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} />
                </Field>
              </>
            ) : (
              <Field label="Duration (minutes)" htmlFor="duration">
                <Select
                  id="duration"
                  value={form.durationMinutes}
                  onChange={(e) => set('durationMinutes', Number(e.target.value))}
                >
                  {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label="Category" htmlFor="category" hint="Created if it doesn't exist">
              <Input id="category" value={form.categoryName} onChange={(e) => set('categoryName', e.target.value)} />
            </Field>
          </div>

          <Field label="Description" htmlFor="description">
            <Textarea id="description" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={!form.name.trim() || form.sellingPrice <= 0}
            >
              Add item
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
