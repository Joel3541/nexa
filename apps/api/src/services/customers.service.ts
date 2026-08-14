import {
  customerEvents,
  customers,
  customerTags,
  getDb,
  invoices,
  orderItems,
  orders,
  type Customer,
  type Executor,
} from '@nexa/database';
import type { CustomerTimelineEntry, CustomerView, CreateCustomerInput, ListCustomersInput } from '@nexa/types';
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { conflict, notFound } from '../lib/errors.js';
import { DAY_MS } from '../lib/dates.js';
import { emitActivity, recordCustomerEvent, trackUsage, writeAudit } from '../db/records.js';
import { inBusiness, ownedRow } from '../db/scope.js';

export const INACTIVE_DAYS = 60;
export const VIP_ORDER_THRESHOLD = 4;

export interface Actor {
  id: string;
  name: string;
  source?: 'user' | 'ai';
}

/* -------------------------------------------------------------------------- */
/* Segmentation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Segments are derived, never stored. They are computed from the rollup columns
 * so they stay correct without a background job, and the same function serves
 * the CRM list, the AI tools and campaign targeting.
 */
export function segmentsFor(customer: {
  totalSpentMinor: number;
  orderCount: number;
  outstandingMinor: number;
  lastPurchaseAt: Date | null;
  createdAt: Date;
  status: string;
}, context: { averageSpendMinor: number; now: Date }): string[] {
  const segments: string[] = [];
  const daysSincePurchase = customer.lastPurchaseAt
    ? Math.floor((context.now.getTime() - customer.lastPurchaseAt.getTime()) / DAY_MS)
    : null;

  if (customer.orderCount >= 2) segments.push('repeat');
  if (customer.orderCount >= VIP_ORDER_THRESHOLD && customer.totalSpentMinor >= context.averageSpendMinor * 2) {
    segments.push('vip');
  }
  if (customer.totalSpentMinor >= context.averageSpendMinor * 1.5 && context.averageSpendMinor > 0) {
    segments.push('high_value');
  }
  if (customer.outstandingMinor > 0) segments.push('owes_money');
  if (customer.orderCount > 0 && daysSincePurchase !== null && daysSincePurchase > INACTIVE_DAYS) {
    segments.push('inactive');
  }
  if (
    customer.orderCount <= 1 &&
    context.now.getTime() - customer.createdAt.getTime() < 30 * DAY_MS
  ) {
    segments.push('new');
  }
  if (customer.status === 'lead') segments.push('lead');
  return segments;
}

async function averageSpend(db: Executor, businessId: string): Promise<number> {
  const [row] = await db
    .select({ average: sql<number>`coalesce(avg(${customers.totalSpentMinor}) filter (where ${customers.orderCount} > 0), 0)` })
    .from(customers)
    .where(eq(customers.businessId, businessId));
  return Math.round(Number(row?.average ?? 0));
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

export async function listCustomers(
  businessId: string,
  query: ListCustomersInput,
  now = new Date(),
): Promise<{ rows: CustomerView[]; total: number }> {
  const db = await getDb();
  const avg = await averageSpend(db, businessId);
  const filters = [eq(customers.businessId, businessId)];

  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(
      or(ilike(customers.name, term), ilike(customers.email, term), ilike(customers.phone, term), ilike(customers.company, term))!,
    );
  }
  if (query.status) filters.push(eq(customers.status, query.status));

  const inactiveCutoff = new Date(now.getTime() - INACTIVE_DAYS * DAY_MS);
  switch (query.segment) {
    case 'owes_money':
      filters.push(gt(customers.outstandingMinor, 0));
      break;
    case 'inactive':
      filters.push(gt(customers.orderCount, 0), lt(customers.lastPurchaseAt, inactiveCutoff));
      break;
    case 'repeat':
      filters.push(sql`${customers.orderCount} >= 2`);
      break;
    case 'vip':
      filters.push(sql`${customers.orderCount} >= ${VIP_ORDER_THRESHOLD}`, gt(customers.totalSpentMinor, avg * 2));
      break;
    case 'high_value':
      filters.push(gt(customers.totalSpentMinor, Math.max(avg, 1)));
      break;
    case 'new':
      filters.push(
        sql`${customers.orderCount} <= 1`,
        gt(customers.createdAt, new Date(now.getTime() - 30 * DAY_MS)),
      );
      break;
    default:
      break;
  }

  if (query.tag) {
    filters.push(
      sql`exists (select 1 from ${customerTags} ct where ct.customer_id = ${customers.id} and lower(ct.tag) = lower(${query.tag}))`,
    );
  }

  const where = and(...filters)!;
  const orderBy = {
    name: asc(customers.name),
    recent: desc(customers.createdAt),
    spend: desc(customers.totalSpentMinor),
    orders: desc(customers.orderCount),
    last_purchase: sql`${customers.lastPurchaseAt} desc nulls last`,
  }[query.sort];

  const [rows, [countRow]] = await Promise.all([
    db
      .select()
      .from(customers)
      .where(where)
      .orderBy(orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(customers).where(where),
  ]);

  const tagMap = await loadTags(
    db,
    businessId,
    rows.map((row) => row.id),
  );

  return {
    rows: rows.map((row) => toCustomerView(row, tagMap.get(row.id) ?? [], avg, now)),
    total: Number(countRow?.count ?? 0),
  };
}

async function loadTags(db: Executor, businessId: string, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ customerId: customerTags.customerId, tag: customerTags.tag })
    .from(customerTags)
    .where(and(eq(customerTags.businessId, businessId), inArray(customerTags.customerId, ids)));
  for (const row of rows) {
    const existing = map.get(row.customerId) ?? [];
    existing.push(row.tag);
    map.set(row.customerId, existing);
  }
  return map;
}

export async function getCustomer(businessId: string, customerId: string, now = new Date()): Promise<CustomerView> {
  const db = await getDb();
  const [row] = await db.select().from(customers).where(ownedRow(customers, customerId, businessId)).limit(1);
  if (!row) throw notFound('That customer');
  const tags = await loadTags(db, businessId, [customerId]);
  return toCustomerView(row, tags.get(customerId) ?? [], await averageSpend(db, businessId), now);
}

export async function getCustomerTimeline(businessId: string, customerId: string): Promise<CustomerTimelineEntry[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(customerEvents)
    .where(and(eq(customerEvents.businessId, businessId), eq(customerEvents.customerId, customerId)))
    .orderBy(desc(customerEvents.occurredAt))
    .limit(100);

  return rows.map((row) => ({
    id: row.id,
    type: row.type as CustomerTimelineEntry['type'],
    title: row.title,
    description: row.description,
    amountMinor: row.amountMinor,
    occurredAt: row.occurredAt.toISOString(),
    linkId: row.linkId,
  }));
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

export async function createCustomer(
  businessId: string,
  input: Pick<CreateCustomerInput, 'name'> & Partial<CreateCustomerInput>,
  actor: Actor,
): Promise<CustomerView> {
  const db = await getDb();

  if (input.email) {
    const existing = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.businessId, businessId), sql`lower(${customers.email}) = lower(${input.email})`))
      .limit(1);
    if (existing.length > 0) {
      throw conflict('A customer with that email already exists.', { email: 'Already used by another customer' });
    }
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(customers)
      .values({
        businessId,
        name: input.name,
        email: input.email || null,
        phone: input.phone ?? null,
        company: input.company ?? null,
        addressLine1: input.addressLine1 ?? null,
        city: input.city ?? null,
        region: input.region ?? null,
        country: input.country ?? null,
        status: input.status ?? 'active',
        notes: input.notes ?? null,
        source: input.source ?? null,
        createdByUserId: actor.id,
      })
      .returning();

    if (input.tags?.length) await setTags(tx, businessId, row!.id, input.tags);

    await recordCustomerEvent(tx, {
      businessId,
      customerId: row!.id,
      type: 'created',
      title: 'Customer added',
      description: actor.source === 'ai' ? 'Added by NEXA AI on your approval.' : `Added by ${actor.name}.`,
      actorUserId: actor.id,
      source: actor.source ?? 'user',
    });

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'customer.created',
      entityType: 'customer',
      entityId: row!.id,
      summary: `${actor.name} added customer ${row!.name}.`,
    });

    await trackUsage(tx, { businessId, userId: actor.id, name: 'customer_created' });
    return row!;
  });

  return toCustomerView(created, input.tags ?? [], await averageSpend(db, businessId), new Date());
}

export async function updateCustomer(
  businessId: string,
  customerId: string,
  input: Partial<CreateCustomerInput>,
  actor: Actor,
): Promise<CustomerView> {
  const db = await getDb();
  const [existing] = await db.select().from(customers).where(ownedRow(customers, customerId, businessId)).limit(1);
  if (!existing) throw notFound('That customer');

  const patch: Partial<typeof customers.$inferInsert> = { updatedAt: new Date() };
  for (const key of ['name', 'phone', 'company', 'addressLine1', 'city', 'region', 'country', 'notes', 'source', 'status'] as const) {
    if (input[key] !== undefined) (patch as Record<string, unknown>)[key] = input[key] ?? null;
  }
  if (input.email !== undefined) patch.email = input.email || null;

  await db.transaction(async (tx) => {
    await tx.update(customers).set(patch).where(ownedRow(customers, customerId, businessId));
    if (input.tags !== undefined) await setTags(tx, businessId, customerId, input.tags ?? []);

    if (input.status && input.status !== existing.status) {
      await recordCustomerEvent(tx, {
        businessId,
        customerId,
        type: 'status',
        title: `Status changed to ${input.status}`,
        actorUserId: actor.id,
        source: actor.source ?? 'user',
      });
    }

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'customer.updated',
      entityType: 'customer',
      entityId: customerId,
      summary: `${actor.name} updated customer ${existing.name}.`,
      metadata: { fields: Object.keys(patch).filter((key) => key !== 'updatedAt') },
    });
  });

  return getCustomer(businessId, customerId);
}

export async function deleteCustomer(businessId: string, customerId: string, actor: Actor): Promise<void> {
  const db = await getDb();
  const [existing] = await db.select().from(customers).where(ownedRow(customers, customerId, businessId)).limit(1);
  if (!existing) throw notFound('That customer');

  const [openInvoices] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        eq(invoices.customerId, customerId),
        inArray(invoices.status, ['sent', 'partial', 'overdue']),
      ),
    );
  if (Number(openInvoices?.count ?? 0) > 0) {
    throw conflict('This customer has unpaid invoices. Settle or void them before deleting.');
  }

  await db.delete(customers).where(ownedRow(customers, customerId, businessId));
  await writeAudit(db, {
    businessId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'customer.deleted',
    entityType: 'customer',
    entityId: customerId,
    summary: `${actor.name} deleted customer ${existing.name}.`,
    metadata: { name: existing.name, totalSpentMinor: existing.totalSpentMinor },
  });
}

export async function addNote(businessId: string, customerId: string, body: string, actor: Actor): Promise<void> {
  const db = await getDb();
  const [existing] = await db.select({ id: customers.id }).from(customers).where(ownedRow(customers, customerId, businessId)).limit(1);
  if (!existing) throw notFound('That customer');
  await recordCustomerEvent(db, {
    businessId,
    customerId,
    type: 'note',
    title: `Note from ${actor.name}`,
    description: body,
    actorUserId: actor.id,
    source: actor.source ?? 'user',
  });
}

async function setTags(db: Executor, businessId: string, customerId: string, tags: string[]): Promise<void> {
  await db.delete(customerTags).where(and(eq(customerTags.businessId, businessId), eq(customerTags.customerId, customerId)));
  const cleaned = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
  if (cleaned.length === 0) return;
  await db
    .insert(customerTags)
    .values(cleaned.map((tag) => ({ businessId, customerId, tag })))
    .onConflictDoNothing();
}

/**
 * Recomputes the denormalised rollups from source rows.
 *
 * Called inside the same transaction as any order/payment/invoice change, so
 * the CRM figures can never drift from the ledger. Recomputing (rather than
 * incrementing) means a correction anywhere upstream self-heals.
 */
export async function recomputeCustomerRollups(db: Executor, businessId: string, customerId: string): Promise<void> {
  const [orderStats] = await db
    .select({
      orderCount: sql<number>`count(*)::int`,
      totalSpent: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::bigint`,
      lastPurchase: sql<Date | null>`max(${orders.occurredAt})`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.businessId, businessId),
        eq(orders.customerId, customerId),
        sql`${orders.status} <> 'cancelled'`,
      ),
    );

  const [outstandingOrders] = await db
    .select({ balance: sql<number>`coalesce(sum(${orders.totalMinor} - ${orders.paidMinor}), 0)::bigint` })
    .from(orders)
    .where(
      and(
        eq(orders.businessId, businessId),
        eq(orders.customerId, customerId),
        sql`${orders.status} <> 'cancelled'`,
        sql`${orders.totalMinor} > ${orders.paidMinor}`,
        // Orders that were converted to an invoice are counted through the
        // invoice instead, so a balance is never double-counted.
        sql`not exists (select 1 from ${invoices} i where i.order_id = ${orders.id} and i.status <> 'void')`,
      ),
    );

  const [outstandingInvoices] = await db
    .select({ balance: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor}), 0)::bigint` })
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        eq(invoices.customerId, customerId),
        inArray(invoices.status, ['sent', 'partial', 'overdue']),
      ),
    );

  await db
    .update(customers)
    .set({
      orderCount: Number(orderStats?.orderCount ?? 0),
      totalSpentMinor: Number(orderStats?.totalSpent ?? 0),
      lastPurchaseAt: orderStats?.lastPurchase ? new Date(orderStats.lastPurchase) : null,
      outstandingMinor: Number(outstandingOrders?.balance ?? 0) + Number(outstandingInvoices?.balance ?? 0),
      updatedAt: new Date(),
    })
    .where(ownedRow(customers, customerId, businessId));
}

/** Products a customer buys most — used by the customer profile and AI. */
export async function favouriteProducts(
  db: Executor,
  businessId: string,
  customerId: string,
  limit = 5,
): Promise<Array<{ name: string; unitsBought: number }>> {
  const rows = await db
    .select({ name: orderItems.name, units: sql<number>`sum(${orderItems.quantity})::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.businessId, businessId), eq(orders.customerId, customerId)))
    .groupBy(orderItems.name)
    .orderBy(desc(sql`sum(${orderItems.quantity})`))
    .limit(limit);
  return rows.map((row) => ({ name: row.name, unitsBought: Number(row.units) }));
}

export function toCustomerView(
  customer: Customer,
  tags: string[],
  averageSpendMinor: number,
  now: Date,
): CustomerView {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    company: customer.company,
    addressLine1: customer.addressLine1,
    city: customer.city,
    region: customer.region,
    country: customer.country,
    status: customer.status,
    tags,
    notes: customer.notes,
    source: customer.source,
    totalSpentMinor: Number(customer.totalSpentMinor),
    orderCount: customer.orderCount,
    outstandingMinor: Number(customer.outstandingMinor),
    averageOrderMinor:
      customer.orderCount > 0 ? Math.round(Number(customer.totalSpentMinor) / customer.orderCount) : 0,
    lastPurchaseAt: customer.lastPurchaseAt?.toISOString() ?? null,
    segments: segmentsFor(
      {
        totalSpentMinor: Number(customer.totalSpentMinor),
        orderCount: customer.orderCount,
        outstandingMinor: Number(customer.outstandingMinor),
        lastPurchaseAt: customer.lastPurchaseAt,
        createdAt: customer.createdAt,
        status: customer.status,
      },
      { averageSpendMinor, now },
    ),
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

/** Shared by the AI tools and the campaign builder. */
export async function findInactiveCustomers(
  businessId: string,
  inactiveDays: number,
  limit = 50,
  now = new Date(),
): Promise<Customer[]> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - inactiveDays * DAY_MS);
  return db
    .select()
    .from(customers)
    .where(
      inBusiness(
        customers,
        businessId,
        gt(customers.orderCount, 0),
        isNotNull(customers.lastPurchaseAt),
        lt(customers.lastPurchaseAt, cutoff),
        sql`${customers.status} <> 'blocked'`,
      ),
    )
    .orderBy(desc(customers.totalSpentMinor))
    .limit(limit);
}

export async function countCustomers(businessId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(customers).where(eq(customers.businessId, businessId));
  return Number(row?.count ?? 0);
}

export { isNull };
