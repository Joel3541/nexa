import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { InventoryMovementView, ProductView } from '@nexa/types';
import { ArrowLeftIcon } from '@/components/icons';
import { PageHeader, StatTile } from '@/components/ui/data';
import { ErrorState, Modal, Skeleton, useToast } from '@/components/ui/feedback';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { dateTime, money, titleCase } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

export default function ProductDetailPage() {
  const { id = '' } = useParams();
  const { currency, locale, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState('purchase');
  const [note, setNote] = useState('');

  const productQuery = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<ProductView>(`/products/${id}`),
  });

  const movementsQuery = useQuery({
    queryKey: ['product-movements', id],
    queryFn: () => api.get<InventoryMovementView[]>(`/products/${id}/movements`),
  });

  const adjust = useMutation({
    mutationFn: () => api.post(`/products/${id}/adjust`, { quantityDelta: delta, reason, note: note || undefined }),
    onSuccess: () => {
      setAdjustOpen(false);
      setDelta(0);
      setNote('');
      toast.success('Stock updated');
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      queryClient.invalidateQueries({ queryKey: ['product-movements', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error) => toast.error('Could not update stock', error instanceof ApiRequestError ? error.message : undefined),
  });

  if (productQuery.isError) {
    return (
      <ErrorState
        message={productQuery.error instanceof Error ? productQuery.error.message : undefined}
        onRetry={() => productQuery.refetch()}
      />
    );
  }

  const product = productQuery.data;

  return (
    <>
      <Link to="/app/products" className="mb-3 inline-flex items-center gap-1.5 text-[13px] muted hover:text-[var(--text)]">
        <ArrowLeftIcon className="size-4" />
        All products
      </Link>

      {!product ? (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <PageHeader
            title={product.name}
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={product.kind === 'service' ? 'info' : 'neutral'}>{titleCase(product.kind)}</Badge>
                {product.sku && <span>SKU {product.sku}</span>}
                {product.categoryName && <span>· {product.categoryName}</span>}
                {product.supplier && <span>· {product.supplier}</span>}
              </span>
            }
            actions={
              product.trackInventory &&
              can('inventory:write') && (
                <Button variant="primary" onClick={() => setAdjustOpen(true)}>
                  Adjust stock
                </Button>
              )
            }
          />

          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Selling price"
              value={money(product.sellingPriceMinor, currency, locale)}
              hint={`Cost ${money(product.costPriceMinor, currency, locale)}`}
            />
            <StatTile
              label="Margin"
              value={product.marginPercent === null ? '—' : `${Math.round(product.marginPercent)}%`}
              hint={`${money(product.marginMinor, currency, locale)} per unit`}
              tone={product.marginPercent !== null && product.marginPercent < 20 ? 'negative' : 'positive'}
            />
            <StatTile
              label="In stock"
              value={product.trackInventory ? String(product.quantity) : 'n/a'}
              hint={product.trackInventory ? `Minimum ${product.minStock}` : 'Service — no stock tracking'}
              tone={product.isLowStock ? 'negative' : 'neutral'}
            />
            <StatTile
              label="Sold in 30 days"
              value={String(product.unitsSold30d)}
              hint={money(product.revenue30dMinor, currency, locale) + ' revenue'}
            />
          </div>

          {product.trackInventory && product.daysOfStockRemaining !== null && (
            <Card className="mb-5 border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20">
              <p className="text-[14px]">
                <strong>Stock projection:</strong> at {(product.unitsSold30d / 30).toFixed(1)} units sold per day over
                the last 30 days, the current {product.quantity} units would last roughly{' '}
                <strong>{product.daysOfStockRemaining} days</strong>.
              </p>
              <p className="mt-1 text-[12.5px] muted">
                Confidence: {product.stockConfidence ?? 'unknown'}. This is a projection from recent demand, not a
                guarantee — a promotion or a quiet week will change it.
              </p>
            </Card>
          )}

          <Card>
            <CardHeader title="Inventory history" subtitle="Every movement, and what caused it" />
            {movementsQuery.isLoading ? (
              <Skeleton className="h-40" />
            ) : (movementsQuery.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-[13.5px] muted">No stock movements recorded.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {movementsQuery.data!.map((movement) => (
                  <li key={movement.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium">{titleCase(movement.reason)}</p>
                      <p className="text-[12.5px] subtle">
                        {dateTime(movement.createdAt, locale)}
                        {movement.note ? ` · ${movement.note}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={`text-[14px] font-semibold tnum ${movement.quantityDelta > 0 ? 'text-positive' : 'text-negative'}`}
                      >
                        {movement.quantityDelta > 0 ? '+' : ''}
                        {movement.quantityDelta}
                      </p>
                      <p className="text-[12px] subtle tnum">→ {movement.balanceAfter}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <Modal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title="Adjust stock"
        description={product ? `Currently ${product.quantity} in stock` : undefined}
        footer={
          <>
            <Button onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => adjust.mutate()} loading={adjust.isPending} disabled={delta === 0}>
              Apply adjustment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Change" htmlFor="delta" hint="Use a negative number to remove stock">
            <Input
              id="delta"
              type="number"
              className="tnum"
              value={delta}
              onChange={(event) => setDelta(Number(event.target.value))}
              autoFocus
            />
          </Field>
          <Field label="Reason" htmlFor="reason">
            <Select id="reason" value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="purchase">Purchase / restock</option>
              <option value="adjustment">Stock count correction</option>
              <option value="return">Customer return</option>
              <option value="damage">Damaged or expired</option>
              <option value="transfer">Transfer</option>
            </Select>
          </Field>
          <Field label="Note" htmlFor="note">
            <Textarea id="note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </Field>
          {product && delta !== 0 && (
            <p className="text-[13px] muted">
              New level: <strong className="tnum">{product.quantity + delta}</strong>
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
