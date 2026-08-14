import {
  customers,
  getDb,
  inventoryMovements,
  invoices,
  orderItems,
  orders,
  payments,
  products,
  type Executor,
  type Order,
} from '@nexa/database';
import type { CreateOrderInput, OrderView, PaymentView } from '@nexa/types';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { emitActivity, recordCustomerEvent, trackUsage, writeAudit } from '../db/records.js';
import { ownedRow } from '../db/scope.js';
import { nextDocumentNumber } from './business.service.js';
import { recomputeCustomerRollups, type Actor } from './customers.service.js';

export interface TaxContext {
  enabled: boolean;
  rate: number;
  inclusive: boolean;
  label: string;
}

/** Orders at or above this value raise an activity card. */
const NOTABLE_ORDER_MINOR = 50_000;

export interface Totals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Single source of truth for document arithmetic — used by orders and invoices
 * alike so a converted invoice can never disagree with its order.
 *
 * Tax-inclusive markets (most of West Africa, the EU, the UK) quote prices with
 * tax already inside, so tax is *extracted* rather than added. Exclusive markets
 * add it on top. Everything is integer minor units; no float rounding drift.
 */
export function computeTotals(
  items: Array<{ quantity: number; unitPriceMinor: number; discountMinor: number }>,
  orderDiscountMinor: number,
  tax: TaxContext,
): Totals {
  const subtotalMinor = items.reduce(
    (sum, item) => sum + Math.max(0, item.quantity * item.unitPriceMinor - item.discountMinor),
    0,
  );
  const discountMinor = Math.min(orderDiscountMinor, subtotalMinor);
  const afterDiscount = subtotalMinor - discountMinor;

  if (!tax.enabled || tax.rate <= 0) {
    return { subtotalMinor, discountMinor, taxMinor: 0, totalMinor: afterDiscount };
  }

  if (tax.inclusive) {
    const taxMinor = Math.round((afterDiscount * tax.rate) / (100 + tax.rate));
    return { subtotalMinor, discountMinor, taxMinor, totalMinor: afterDiscount };
  }

  const taxMinor = Math.round((afterDiscount * tax.rate) / 100);
  return { subtotalMinor, discountMinor, taxMinor, totalMinor: afterDiscount + taxMinor };
}

export function paymentStatusFor(totalMinor: number, paidMinor: number): 'unpaid' | 'partial' | 'paid' {
  if (paidMinor <= 0) return 'unpaid';
  if (paidMinor >= totalMinor) return 'paid';
  return 'partial';
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

export async function createOrder(
  businessId: string,
  input: CreateOrderInput,
  actor: Actor,
  tax: TaxContext,
): Promise<OrderView> {
  const db = await getDb();

  const orderId = await db.transaction(async (tx) => {
    // Resolve every line against the catalogue *inside* the transaction so
    // stock checks and the decrement cannot race with another sale.
    const productIds = input.items.map((item) => item.productId).filter(Boolean) as string[];
    const catalogue = productIds.length
      ? await tx.select().from(products).where(and(eq(products.businessId, businessId), inArray(products.id, productIds)))
      : [];
    const byId = new Map(catalogue.map((product) => [product.id, product]));

    const lines = input.items.map((item) => {
      if (item.productId) {
        const product = byId.get(item.productId);
        if (!product) throw notFound('One of the products on this sale');
        return {
          productId: product.id,
          name: product.name,
          quantity: item.quantity,
          unitPriceMinor: item.unitPrice ?? Number(product.sellingPriceMinor),
          unitCostMinor: Number(product.costPriceMinor),
          discountMinor: item.discountMinor,
          tracksInventory: product.trackInventory && product.kind === 'physical',
          available: product.quantity,
        };
      }
      if (!item.name || item.unitPrice === undefined) {
        throw badRequest('Custom line items need a name and a price.');
      }
      return {
        productId: null,
        name: item.name,
        quantity: item.quantity,
        unitPriceMinor: item.unitPrice,
        unitCostMinor: 0,
        discountMinor: item.discountMinor,
        tracksInventory: false,
        available: 0,
      };
    });

    for (const line of lines) {
      if (line.tracksInventory && line.quantity > line.available) {
        throw conflict(`Only ${line.available} of "${line.name}" left in stock.`);
      }
    }

    let isFirstPurchase = false;
    if (input.customerId) {
      const [customer] = await tx
        .select({ id: customers.id, orderCount: customers.orderCount })
        .from(customers)
        .where(ownedRow(customers, input.customerId, businessId))
        .limit(1);
      if (!customer) throw notFound('That customer');
      isFirstPurchase = customer.orderCount === 0;
    }

    const totals = computeTotals(
      lines.map((line) => ({ quantity: line.quantity, unitPriceMinor: line.unitPriceMinor, discountMinor: line.discountMinor })),
      input.discountMinor,
      input.taxRate !== undefined ? { ...tax, enabled: input.taxRate > 0, rate: input.taxRate } : tax,
    );
    const costMinor = lines.reduce((sum, line) => sum + line.quantity * line.unitCostMinor, 0);
    const paidMinor = input.payment?.amountMinor ?? 0;
    if (paidMinor > totals.totalMinor) {
      throw badRequest('The payment is larger than the order total.');
    }

    const reference = await nextDocumentNumber(tx, businessId, 'order');
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

    const [order] = await tx
      .insert(orders)
      .values({
        businessId,
        reference,
        customerId: input.customerId ?? null,
        status: input.status,
        paymentStatus: paymentStatusFor(totals.totalMinor, paidMinor),
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        paidMinor,
        costMinor,
        channel: input.channel ?? null,
        note: input.note ?? null,
        createdByUserId: actor.id,
        source: actor.source ?? 'user',
        occurredAt,
      })
      .returning();

    await tx.insert(orderItems).values(
      lines.map((line) => ({
        businessId,
        orderId: order!.id,
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        unitCostMinor: line.unitCostMinor,
        discountMinor: line.discountMinor,
        totalMinor: Math.max(0, line.quantity * line.unitPriceMinor - line.discountMinor),
      })),
    );

    if (input.status !== 'cancelled' && input.status !== 'draft') {
      await applyStockForOrder(tx, businessId, order!.id, lines, actor);
    }

    if (paidMinor > 0) {
      await tx.insert(payments).values({
        businessId,
        customerId: input.customerId ?? null,
        orderId: order!.id,
        amountMinor: paidMinor,
        method: input.payment!.method,
        reference: input.payment!.reference ?? null,
        createdByUserId: actor.id,
        receivedAt: occurredAt,
      });
    }

    if (input.customerId) {
      await recomputeCustomerRollups(tx, businessId, input.customerId);
      await recordCustomerEvent(tx, {
        businessId,
        customerId: input.customerId,
        type: 'order',
        title: `Order ${reference}`,
        description: `${lines.length} item${lines.length === 1 ? '' : 's'} · ${paymentStatusFor(totals.totalMinor, paidMinor)}`,
        amountMinor: totals.totalMinor,
        linkId: order!.id,
        actorUserId: actor.id,
        source: actor.source ?? 'user',
        occurredAt,
      });
    }

    // The activity feed is for signal, not a transaction log — every sale is
    // already in the sales module. Only genuinely notable sales surface here:
    // a customer's first purchase, or an unusually large order.
    const isNotable = isFirstPurchase || totals.totalMinor >= NOTABLE_ORDER_MINOR;
    if (isNotable) {
      await emitActivity(tx, {
        businessId,
        type: isFirstPurchase ? 'order.first_purchase' : 'order.large',
        severity: 'success',
        source: actor.source ?? 'user',
        title: isFirstPurchase ? `First purchase from a new customer — ${reference}` : `Large sale ${reference}`,
        description: `${lines.length} item${lines.length === 1 ? '' : 's'}`,
        entityType: 'order',
        entityId: order!.id,
        actionLabel: 'View sale',
        actionHref: `/app/sales/${order!.id}`,
        actorUserId: actor.id,
      });
    }

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'order.created',
      entityType: 'order',
      entityId: order!.id,
      summary: `${actor.name} recorded sale ${reference}.`,
      metadata: { totalMinor: totals.totalMinor, itemCount: lines.length },
    });

    await trackUsage(tx, { businessId, userId: actor.id, name: 'order_created', properties: { itemCount: lines.length } });
    return order!.id;
  });

  return getOrder(businessId, orderId);
}

async function applyStockForOrder(
  tx: Executor,
  businessId: string,
  orderId: string,
  lines: Array<{ productId: string | null; name: string; quantity: number; tracksInventory: boolean; unitCostMinor: number }>,
  actor: Actor,
): Promise<void> {
  for (const line of lines) {
    if (!line.tracksInventory || !line.productId) continue;
    const [updated] = await tx
      .update(products)
      .set({ quantity: sql`${products.quantity} - ${line.quantity}`, updatedAt: new Date() })
      .where(ownedRow(products, line.productId, businessId))
      .returning({ quantity: products.quantity, minStock: products.minStock, name: products.name });

    await tx.insert(inventoryMovements).values({
      businessId,
      productId: line.productId,
      quantityDelta: -line.quantity,
      balanceAfter: updated!.quantity,
      reason: 'sale',
      unitCostMinor: line.unitCostMinor,
      orderId,
      actorUserId: actor.id,
      source: actor.source ?? 'user',
    });

    if (updated!.quantity <= updated!.minStock) {
      await emitActivity(tx, {
        businessId,
        type: 'inventory.low_stock',
        severity: updated!.quantity <= 0 ? 'critical' : 'warning',
        title:
          updated!.quantity <= 0
            ? `${updated!.name} is out of stock`
            : `${updated!.name} is running low — ${updated!.quantity} left`,
        description: `This sale took it to or below the minimum of ${updated!.minStock}.`,
        entityType: 'product',
        entityId: line.productId,
        actionLabel: 'Restock',
        actionHref: `/app/products/${line.productId}`,
        dedupeKey: `low_stock:${line.productId}:${updated!.quantity}`,
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

export async function getOrder(businessId: string, orderId: string): Promise<OrderView> {
  const db = await getDb();
  const [row] = await db
    .select({ order: orders, customerName: customers.name })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(ownedRow(orders, orderId, businessId))
    .limit(1);
  if (!row) throw notFound('That sale');

  const [items, paymentRows] = await Promise.all([
    db.select().from(orderItems).where(and(eq(orderItems.businessId, businessId), eq(orderItems.orderId, orderId))),
    db
      .select()
      .from(payments)
      .where(and(eq(payments.businessId, businessId), eq(payments.orderId, orderId)))
      .orderBy(desc(payments.receivedAt)),
  ]);

  return toOrderView(row.order, row.customerName, items, paymentRows);
}

export async function listOrders(
  businessId: string,
  query: {
    page: number;
    pageSize: number;
    q?: string;
    customerId?: string;
    status?: string;
    paymentStatus?: string;
    from?: string;
    to?: string;
  },
): Promise<{ rows: OrderView[]; total: number }> {
  const db = await getDb();
  const filters = [eq(orders.businessId, businessId)];
  if (query.customerId) filters.push(eq(orders.customerId, query.customerId));
  if (query.status) filters.push(eq(orders.status, query.status as 'confirmed'));
  if (query.paymentStatus) filters.push(eq(orders.paymentStatus, query.paymentStatus as 'paid'));
  if (query.from) filters.push(gte(orders.occurredAt, new Date(query.from)));
  if (query.to) filters.push(lte(orders.occurredAt, new Date(query.to)));
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(or(ilike(orders.reference, term), ilike(customers.name, term))!);
  }
  const where = and(...filters)!;

  const [rows, [countRow]] = await Promise.all([
    db
      .select({ order: orders, customerName: customers.name })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(where)
      .orderBy(desc(orders.occurredAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(where),
  ]);

  const ids = rows.map((row) => row.order.id);
  const items = ids.length
    ? await db.select().from(orderItems).where(and(eq(orderItems.businessId, businessId), inArray(orderItems.orderId, ids)))
    : [];
  const grouped = new Map<string, typeof items>();
  for (const item of items) {
    const bucket = grouped.get(item.orderId) ?? [];
    bucket.push(item);
    grouped.set(item.orderId, bucket);
  }

  return {
    rows: rows.map((row) => toOrderView(row.order, row.customerName, grouped.get(row.order.id) ?? [], [])),
    total: Number(countRow?.count ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Payments & status                                                           */
/* -------------------------------------------------------------------------- */

export async function recordOrderPayment(
  businessId: string,
  orderId: string,
  input: { amountMinor: number; method: string; reference?: string; note?: string; receivedAt?: string },
  actor: Actor,
): Promise<OrderView> {
  const db = await getDb();

  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(ownedRow(orders, orderId, businessId)).limit(1);
    if (!order) throw notFound('That sale');

    const balance = Number(order.totalMinor) - Number(order.paidMinor);
    if (input.amountMinor > balance) {
      throw badRequest(`That is more than the outstanding balance of ${balance / 100}.`);
    }

    const paidMinor = Number(order.paidMinor) + input.amountMinor;
    await tx
      .update(orders)
      .set({
        paidMinor,
        paymentStatus: paymentStatusFor(Number(order.totalMinor), paidMinor),
        updatedAt: new Date(),
      })
      .where(ownedRow(orders, orderId, businessId));

    await tx.insert(payments).values({
      businessId,
      customerId: order.customerId,
      orderId,
      amountMinor: input.amountMinor,
      method: input.method as 'cash',
      reference: input.reference ?? null,
      note: input.note ?? null,
      createdByUserId: actor.id,
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
    });

    if (order.customerId) {
      await recomputeCustomerRollups(tx, businessId, order.customerId);
      await recordCustomerEvent(tx, {
        businessId,
        customerId: order.customerId,
        type: 'payment',
        title: `Payment received on ${order.reference}`,
        amountMinor: input.amountMinor,
        linkId: orderId,
        actorUserId: actor.id,
        source: actor.source ?? 'user',
      });
    }

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'payment.recorded',
      entityType: 'order',
      entityId: orderId,
      summary: `${actor.name} recorded a payment on ${order.reference}.`,
      metadata: { amountMinor: input.amountMinor, method: input.method },
    });
  });

  return getOrder(businessId, orderId);
}

export async function updateOrderStatus(
  businessId: string,
  orderId: string,
  input: { status?: string; note?: string },
  actor: Actor,
): Promise<OrderView> {
  const db = await getDb();

  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(ownedRow(orders, orderId, businessId)).limit(1);
    if (!order) throw notFound('That sale');

    // Cancelling returns stock to the shelf, with a matching movement so the
    // inventory ledger always explains the current quantity.
    if (input.status === 'cancelled' && order.status !== 'cancelled') {
      const items = await tx
        .select()
        .from(orderItems)
        .where(and(eq(orderItems.businessId, businessId), eq(orderItems.orderId, orderId)));
      for (const item of items) {
        if (!item.productId) continue;
        const [updated] = await tx
          .update(products)
          .set({ quantity: sql`${products.quantity} + ${item.quantity}`, updatedAt: new Date() })
          .where(ownedRow(products, item.productId, businessId))
          .returning({ quantity: products.quantity });
        if (!updated) continue;
        await tx.insert(inventoryMovements).values({
          businessId,
          productId: item.productId,
          quantityDelta: item.quantity,
          balanceAfter: updated.quantity,
          reason: 'return',
          orderId,
          note: `Sale ${order.reference} cancelled.`,
          actorUserId: actor.id,
          source: actor.source ?? 'user',
        });
      }
    }

    await tx
      .update(orders)
      .set({
        ...(input.status ? { status: input.status as 'confirmed' } : {}),
        ...(input.note !== undefined ? { note: input.note ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(ownedRow(orders, orderId, businessId));

    if (order.customerId) await recomputeCustomerRollups(tx, businessId, order.customerId);

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: 'order.updated',
      entityType: 'order',
      entityId: orderId,
      summary: `${actor.name} updated sale ${order.reference}${input.status ? ` to ${input.status}` : ''}.`,
    });
  });

  return getOrder(businessId, orderId);
}

/* -------------------------------------------------------------------------- */
/* Views                                                                       */
/* -------------------------------------------------------------------------- */

export function toPaymentView(payment: typeof payments.$inferSelect): PaymentView {
  return {
    id: payment.id,
    amountMinor: Number(payment.amountMinor),
    method: payment.method,
    reference: payment.reference,
    note: payment.note,
    provider: payment.provider,
    providerRef: payment.providerRef,
    receivedAt: payment.receivedAt.toISOString(),
  };
}

export function toOrderView(
  order: Order,
  customerName: string | null,
  items: Array<typeof orderItems.$inferSelect>,
  paymentRows: Array<typeof payments.$inferSelect>,
): OrderView {
  const totalMinor = Number(order.totalMinor);
  const paidMinor = Number(order.paidMinor);
  const costMinor = Number(order.costMinor);
  return {
    id: order.id,
    reference: order.reference,
    customerId: order.customerId,
    customerName,
    status: order.status,
    paymentStatus: order.paymentStatus,
    subtotalMinor: Number(order.subtotalMinor),
    discountMinor: Number(order.discountMinor),
    taxMinor: Number(order.taxMinor),
    totalMinor,
    paidMinor,
    balanceMinor: totalMinor - paidMinor,
    costMinor,
    profitMinor: totalMinor - Number(order.taxMinor) - costMinor,
    channel: order.channel,
    note: order.note,
    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitPriceMinor: Number(item.unitPriceMinor),
      discountMinor: Number(item.discountMinor),
      totalMinor: Number(item.totalMinor),
    })),
    payments: paymentRows.map(toPaymentView),
    occurredAt: order.occurredAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
  };
}

/** Guards against deleting a customer/product that a sale depends on. */
export async function orderExistsForInvoice(businessId: string, orderId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.orderId, orderId)))
    .limit(1);
  return Boolean(row);
}
