import { formatMoney } from '@nexa/config';
import {
  customers,
  getDb,
  invoiceItems,
  invoices,
  messageOutbox,
  orders,
  payments,
  products,
  type Executor,
  type Invoice,
} from '@nexa/database';
import { getChannelAdapter } from '@nexa/integrations';
import type { CreateInvoiceInput, InvoiceView } from '@nexa/types';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { DAY_MS, isoDay } from '../lib/dates.js';
import { emitActivity, recordCustomerEvent, trackUsage, writeAudit } from '../db/records.js';
import { ownedRow } from '../db/scope.js';
import { nextDocumentNumber } from './business.service.js';
import { recomputeCustomerRollups, type Actor } from './customers.service.js';
import { computeTotals, paymentStatusFor, toPaymentView, type TaxContext } from './orders.service.js';

export interface InvoiceContext extends TaxContext {
  currency: string;
  locale: string;
  businessName: string;
  dueDays: number;
}

function daysOverdue(dueDate: string, status: string, now: Date): number {
  if (status === 'paid' || status === 'void' || status === 'draft') return 0;
  const due = new Date(`${dueDate}T23:59:59.999Z`).getTime();
  const diff = now.getTime() - due;
  return diff > 0 ? Math.floor(diff / DAY_MS) : 0;
}

/**
 * `overdue` is derived at read time from the due date rather than stored, so an
 * invoice is never stale-labelled because a nightly job did not run.
 */
function effectiveStatus(invoice: Invoice, now: Date): InvoiceView['status'] {
  if (invoice.status === 'sent' || invoice.status === 'partial') {
    return daysOverdue(invoice.dueDate, invoice.status, now) > 0 ? 'overdue' : invoice.status;
  }
  return invoice.status;
}

export async function createInvoice(
  businessId: string,
  input: CreateInvoiceInput,
  actor: Actor,
  context: InvoiceContext,
): Promise<InvoiceView> {
  const db = await getDb();

  const invoiceId = await db.transaction(async (tx) => {
    const [customer] = await tx
      .select()
      .from(customers)
      .where(ownedRow(customers, input.customerId, businessId))
      .limit(1);
    if (!customer) throw notFound('That customer');

    if (input.orderId) {
      const [order] = await tx.select({ id: orders.id }).from(orders).where(ownedRow(orders, input.orderId, businessId)).limit(1);
      if (!order) throw notFound('That sale');
      const [existing] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.businessId, businessId), eq(invoices.orderId, input.orderId), sql`${invoices.status} <> 'void'`))
        .limit(1);
      if (existing) throw conflict('That sale already has an invoice.');
    }

    const productIds = input.items.map((item) => item.productId).filter(Boolean) as string[];
    const catalogue = productIds.length
      ? await tx.select().from(products).where(and(eq(products.businessId, businessId), inArray(products.id, productIds)))
      : [];
    const byId = new Map(catalogue.map((product) => [product.id, product]));

    const lines = input.items.map((item) => {
      const product = item.productId ? byId.get(item.productId) : undefined;
      if (item.productId && !product) throw notFound('One of the products on this invoice');
      const unitPriceMinor = item.unitPrice ?? (product ? Number(product.sellingPriceMinor) : undefined);
      if (unitPriceMinor === undefined) throw badRequest('Every line needs a price.');
      const name = item.name ?? product?.name;
      if (!name) throw badRequest('Every line needs a description.');
      return {
        productId: product?.id ?? null,
        name,
        quantity: item.quantity,
        unitPriceMinor,
        discountMinor: item.discountMinor,
      };
    });

    const taxContext: TaxContext =
      input.taxRate !== undefined ? { ...context, enabled: input.taxRate > 0, rate: input.taxRate } : context;
    const totals = computeTotals(lines, input.discountMinor, taxContext);

    const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
    const dueDate = input.dueDate ? new Date(input.dueDate) : new Date(issueDate.getTime() + context.dueDays * DAY_MS);
    if (dueDate.getTime() < issueDate.getTime()) throw badRequest('The due date cannot be before the issue date.');

    const number = await nextDocumentNumber(tx, businessId, 'invoice');

    const [invoice] = await tx
      .insert(invoices)
      .values({
        businessId,
        number,
        customerId: input.customerId,
        orderId: input.orderId ?? null,
        status: input.status,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        paidMinor: 0,
        issueDate: isoDay(issueDate),
        dueDate: isoDay(dueDate),
        notes: input.notes ?? null,
        sentAt: input.status === 'sent' ? new Date() : null,
        createdByUserId: actor.id,
        source: actor.source ?? 'user',
      })
      .returning();

    await tx.insert(invoiceItems).values(
      lines.map((line) => ({
        businessId,
        invoiceId: invoice!.id,
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        discountMinor: line.discountMinor,
        totalMinor: Math.max(0, line.quantity * line.unitPriceMinor - line.discountMinor),
      })),
    );

    await recomputeCustomerRollups(tx, businessId, input.customerId);
    await recordCustomerEvent(tx, {
      businessId,
      customerId: input.customerId,
      type: 'invoice',
      title: `Invoice ${number} ${input.status === 'sent' ? 'sent' : 'created'}`,
      description: `Due ${isoDay(dueDate)}`,
      amountMinor: totals.totalMinor,
      linkId: invoice!.id,
      actorUserId: actor.id,
      source: actor.source ?? 'user',
    });

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: invoice!.id,
      summary: `${actor.name} created invoice ${number} for ${customer.name}.`,
      metadata: { totalMinor: totals.totalMinor, dueDate: isoDay(dueDate) },
    });
    await trackUsage(tx, { businessId, userId: actor.id, name: 'invoice_created' });

    return invoice!.id;
  });

  return getInvoice(businessId, invoiceId);
}

export async function getInvoice(businessId: string, invoiceId: string, now = new Date()): Promise<InvoiceView> {
  const db = await getDb();
  const [row] = await db
    .select({ invoice: invoices, customerName: customers.name, customerEmail: customers.email })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(ownedRow(invoices, invoiceId, businessId))
    .limit(1);
  if (!row) throw notFound('That invoice');

  const [items, paymentRows] = await Promise.all([
    db.select().from(invoiceItems).where(and(eq(invoiceItems.businessId, businessId), eq(invoiceItems.invoiceId, invoiceId))),
    db
      .select()
      .from(payments)
      .where(and(eq(payments.businessId, businessId), eq(payments.invoiceId, invoiceId)))
      .orderBy(desc(payments.receivedAt)),
  ]);

  return toInvoiceView(row.invoice, row.customerName, row.customerEmail, items, paymentRows, now);
}

export async function listInvoices(
  businessId: string,
  query: {
    page: number;
    pageSize: number;
    q?: string;
    customerId?: string;
    status?: string;
    overdueOnly?: boolean;
    from?: string;
    to?: string;
  },
  now = new Date(),
): Promise<{ rows: InvoiceView[]; total: number }> {
  const db = await getDb();
  const filters = [eq(invoices.businessId, businessId)];
  if (query.customerId) filters.push(eq(invoices.customerId, query.customerId));
  if (query.from) filters.push(gte(invoices.issueDate, query.from.slice(0, 10)));
  if (query.to) filters.push(lte(invoices.issueDate, query.to.slice(0, 10)));
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(or(ilike(invoices.number, term), ilike(customers.name, term))!);
  }

  // "overdue" is a derived state, so it is expressed as a predicate on the due
  // date rather than a stored status value.
  if (query.overdueOnly || query.status === 'overdue') {
    filters.push(
      inArray(invoices.status, ['sent', 'partial', 'overdue']),
      sql`${invoices.dueDate} < ${isoDay(now)}`,
      sql`${invoices.totalMinor} > ${invoices.paidMinor}`,
    );
  } else if (query.status === 'unpaid') {
    filters.push(inArray(invoices.status, ['sent', 'partial', 'overdue']));
  } else if (query.status) {
    filters.push(eq(invoices.status, query.status as 'draft'));
  }

  const where = and(...filters)!;
  // When listing overdue invoices, order by due date ascending so a capped page
  // contains the *most* overdue ones. Sorting only within the page would report
  // the oldest of an arbitrary slice as the oldest overall.
  const overdueView = query.overdueOnly || query.status === 'overdue';
  const [rows, [countRow]] = await Promise.all([
    db
      .select({ invoice: invoices, customerName: customers.name, customerEmail: customers.email })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(where)
      .orderBy(...(overdueView ? [asc(invoices.dueDate)] : [desc(invoices.issueDate), desc(invoices.createdAt)]))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(where),
  ]);

  const ids = rows.map((row) => row.invoice.id);
  const items = ids.length
    ? await db.select().from(invoiceItems).where(and(eq(invoiceItems.businessId, businessId), inArray(invoiceItems.invoiceId, ids)))
    : [];
  const grouped = new Map<string, typeof items>();
  for (const item of items) {
    const bucket = grouped.get(item.invoiceId) ?? [];
    bucket.push(item);
    grouped.set(item.invoiceId, bucket);
  }

  return {
    rows: rows.map((row) =>
      toInvoiceView(row.invoice, row.customerName, row.customerEmail, grouped.get(row.invoice.id) ?? [], [], now),
    ),
    total: Number(countRow?.count ?? 0),
  };
}

export async function overdueInvoices(businessId: string, limit = 25, now = new Date()): Promise<InvoiceView[]> {
  const { rows } = await listInvoices(businessId, { page: 1, pageSize: limit, overdueOnly: true }, now);
  return rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export async function updateInvoice(
  businessId: string,
  invoiceId: string,
  input: { status?: string; dueDate?: string; notes?: string },
  actor: Actor,
): Promise<InvoiceView> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(ownedRow(invoices, invoiceId, businessId)).limit(1);
    if (!invoice) throw notFound('That invoice');

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.dueDate) patch.dueDate = input.dueDate.slice(0, 10);
    if (input.notes !== undefined) patch.notes = input.notes ?? null;

    if (input.status && input.status !== invoice.status) {
      if (input.status === 'paid') {
        patch.paidMinor = Number(invoice.totalMinor);
        patch.paidAt = new Date();
        const balance = Number(invoice.totalMinor) - Number(invoice.paidMinor);
        if (balance > 0) {
          // Marking paid must leave a payment record, or the ledger and the
          // invoice would disagree about where the money came from.
          await tx.insert(payments).values({
            businessId,
            customerId: invoice.customerId,
            invoiceId,
            amountMinor: balance,
            method: 'other',
            note: 'Recorded when the invoice was marked paid.',
            createdByUserId: actor.id,
          });
        }
      }
      if (input.status === 'sent' && !invoice.sentAt) patch.sentAt = new Date();
      patch.status = input.status;
    }

    await tx.update(invoices).set(patch).where(ownedRow(invoices, invoiceId, businessId));
    await recomputeCustomerRollups(tx, businessId, invoice.customerId);

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: invoiceId,
      summary: `${actor.name} updated invoice ${invoice.number}${input.status ? ` to ${input.status}` : ''}.`,
    });

    if (input.status === 'paid') {
      await emitActivity(tx, {
        businessId,
        type: 'invoice.paid',
        severity: 'success',
        title: `Invoice ${invoice.number} paid`,
        entityType: 'invoice',
        entityId: invoiceId,
        actionHref: `/app/invoices/${invoiceId}`,
        actionLabel: 'View invoice',
      });
    }
  });

  return getInvoice(businessId, invoiceId);
}

export async function recordInvoicePayment(
  businessId: string,
  invoiceId: string,
  input: { amountMinor: number; method: string; reference?: string; note?: string; receivedAt?: string },
  actor: Actor,
): Promise<InvoiceView> {
  const db = await getDb();

  await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(ownedRow(invoices, invoiceId, businessId)).limit(1);
    if (!invoice) throw notFound('That invoice');
    if (invoice.status === 'void') throw badRequest('This invoice has been voided.');

    const balance = Number(invoice.totalMinor) - Number(invoice.paidMinor);
    if (input.amountMinor > balance) throw badRequest('That is more than the outstanding balance on this invoice.');

    const paidMinor = Number(invoice.paidMinor) + input.amountMinor;
    const status = paymentStatusFor(Number(invoice.totalMinor), paidMinor);

    await tx
      .update(invoices)
      .set({
        paidMinor,
        status: status === 'paid' ? 'paid' : 'partial',
        paidAt: status === 'paid' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(ownedRow(invoices, invoiceId, businessId));

    await tx.insert(payments).values({
      businessId,
      customerId: invoice.customerId,
      invoiceId,
      amountMinor: input.amountMinor,
      method: input.method as 'cash',
      reference: input.reference ?? null,
      note: input.note ?? null,
      createdByUserId: actor.id,
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
    });

    await recomputeCustomerRollups(tx, businessId, invoice.customerId);
    await recordCustomerEvent(tx, {
      businessId,
      customerId: invoice.customerId,
      type: 'payment',
      title: `Payment on invoice ${invoice.number}`,
      amountMinor: input.amountMinor,
      linkId: invoiceId,
      actorUserId: actor.id,
      source: actor.source ?? 'user',
    });

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'payment.recorded',
      entityType: 'invoice',
      entityId: invoiceId,
      summary: `${actor.name} recorded ${input.amountMinor} on invoice ${invoice.number}.`,
      metadata: { amountMinor: input.amountMinor, method: input.method },
    });
  });

  return getInvoice(businessId, invoiceId);
}

/**
 * Queues an invoice for delivery through the configured channel adapter.
 *
 * With the console adapter the row is marked `simulated`, and the API says so —
 * the user is told the invoice was prepared, not that the customer received it.
 */
export async function sendInvoice(
  businessId: string,
  invoiceId: string,
  actor: Actor,
  context: InvoiceContext,
): Promise<{ invoice: InvoiceView; simulated: boolean; recipient: string }> {
  const db = await getDb();
  const invoice = await getInvoice(businessId, invoiceId);
  if (!invoice.customerEmail) {
    throw badRequest('That customer has no email address. Add one, or download the invoice and send it yourself.');
  }

  const body = [
    `Hi ${invoice.customerName},`,
    '',
    `Please find invoice ${invoice.number} from ${context.businessName}.`,
    `Amount due: ${formatMoney(invoice.balanceMinor, context.currency, { locale: context.locale })}`,
    `Due date: ${invoice.dueDate}`,
    '',
    ...invoice.items.map(
      (item) =>
        `  ${item.quantity} x ${item.name} — ${formatMoney(item.totalMinor, context.currency, { locale: context.locale })}`,
    ),
    '',
    `Total: ${formatMoney(invoice.totalMinor, context.currency, { locale: context.locale })}`,
    invoice.notes ? `\n${invoice.notes}` : '',
    '',
    `Thank you,\n${context.businessName}`,
  ].join('\n');

  const adapter = getChannelAdapter('email');
  const result = await adapter.send({
    channel: 'email',
    to: invoice.customerEmail,
    subject: `Invoice ${invoice.number} from ${context.businessName}`,
    body,
  });

  await db.transaction(async (tx) => {
    await tx.insert(messageOutbox).values({
      businessId,
      channel: 'email',
      provider: adapter.provider,
      recipient: invoice.customerEmail!,
      subject: `Invoice ${invoice.number}`,
      body,
      status: result.status,
      simulated: result.simulated,
      customerId: invoice.customerId,
      sentAt: new Date(),
    });

    await tx
      .update(invoices)
      .set({ status: invoice.status === 'draft' ? 'sent' : invoice.status, sentAt: new Date(), updatedAt: new Date() })
      .where(ownedRow(invoices, invoiceId, businessId));

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'invoice.sent',
      entityType: 'invoice',
      entityId: invoiceId,
      summary: `${actor.name} sent invoice ${invoice.number} to ${invoice.customerEmail}${result.simulated ? ' (simulated — no live email provider configured)' : ''}.`,
      metadata: { simulated: result.simulated, provider: adapter.provider },
    });
  });

  return { invoice: await getInvoice(businessId, invoiceId), simulated: result.simulated, recipient: invoice.customerEmail };
}

export async function outstandingTotals(
  db: Executor,
  businessId: string,
  now = new Date(),
): Promise<{ totalMinor: number; overdueMinor: number; invoiceCount: number; overdueCount: number }> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
      overdue: sql<number>`coalesce(sum(case when ${invoices.dueDate} < ${isoDay(now)} then ${invoices.totalMinor} - ${invoices.paidMinor} else 0 end), 0)::bigint`,
      overdueCount: sql<number>`count(*) filter (where ${invoices.dueDate} < ${isoDay(now)})::int`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        inArray(invoices.status, ['sent', 'partial', 'overdue']),
        sql`${invoices.totalMinor} > ${invoices.paidMinor}`,
      ),
    );

  return {
    totalMinor: Number(row?.total ?? 0),
    overdueMinor: Number(row?.overdue ?? 0),
    invoiceCount: Number(row?.count ?? 0),
    overdueCount: Number(row?.overdueCount ?? 0),
  };
}

export function toInvoiceView(
  invoice: Invoice,
  customerName: string,
  customerEmail: string | null,
  items: Array<typeof invoiceItems.$inferSelect>,
  paymentRows: Array<typeof payments.$inferSelect>,
  now: Date,
): InvoiceView {
  const totalMinor = Number(invoice.totalMinor);
  const paidMinor = Number(invoice.paidMinor);
  const status = effectiveStatus(invoice, now);
  return {
    id: invoice.id,
    number: invoice.number,
    customerId: invoice.customerId,
    customerName,
    customerEmail,
    orderId: invoice.orderId,
    status,
    subtotalMinor: Number(invoice.subtotalMinor),
    discountMinor: Number(invoice.discountMinor),
    taxMinor: Number(invoice.taxMinor),
    totalMinor,
    paidMinor,
    balanceMinor: totalMinor - paidMinor,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    daysOverdue: daysOverdue(invoice.dueDate, invoice.status, now),
    notes: invoice.notes,
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
    sentAt: invoice.sentAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
  };
}
