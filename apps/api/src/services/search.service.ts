import { formatMoney } from '@nexa/config';
import { appointments, customers, expenses, getDb, invoices, orders, products, tasks } from '@nexa/database';
import type { SearchResultGroup } from '@nexa/types';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';

/**
 * Universal search across the business graph.
 *
 * Runs one bounded query per entity type in parallel rather than a single
 * UNION, so each group can rank by its own notion of relevance and a slow
 * entity type cannot stall the whole result. Every query is tenant-scoped.
 */
export async function globalSearch(
  businessId: string,
  term: string,
  limit: number,
  currency: string,
  locale: string,
): Promise<SearchResultGroup[]> {
  const db = await getDb();
  const pattern = `%${term}%`;
  const perGroup = Math.max(3, Math.floor(limit / 4));
  const money = (minor: number) => formatMoney(minor, currency, { locale });

  const [customerRows, productRows, invoiceRows, orderRows, taskRows, appointmentRows, expenseRows] = await Promise.all([
    db
      .select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, spent: customers.totalSpentMinor })
      .from(customers)
      .where(
        and(
          eq(customers.businessId, businessId),
          or(ilike(customers.name, pattern), ilike(customers.email, pattern), ilike(customers.phone, pattern), ilike(customers.company, pattern)),
        ),
      )
      .orderBy(desc(customers.totalSpentMinor))
      .limit(perGroup),

    db
      .select({ id: products.id, name: products.name, sku: products.sku, price: products.sellingPriceMinor, quantity: products.quantity })
      .from(products)
      .where(and(eq(products.businessId, businessId), or(ilike(products.name, pattern), ilike(products.sku, pattern))))
      .limit(perGroup),

    db
      .select({
        id: invoices.id,
        number: invoices.number,
        total: invoices.totalMinor,
        paid: invoices.paidMinor,
        status: invoices.status,
        customerName: customers.name,
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(and(eq(invoices.businessId, businessId), or(ilike(invoices.number, pattern), ilike(customers.name, pattern))))
      .orderBy(desc(invoices.issueDate))
      .limit(perGroup),

    db
      .select({ id: orders.id, reference: orders.reference, total: orders.totalMinor, occurredAt: orders.occurredAt, customerName: customers.name })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.businessId, businessId), or(ilike(orders.reference, pattern), ilike(customers.name, pattern))))
      .orderBy(desc(orders.occurredAt))
      .limit(perGroup),

    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate })
      .from(tasks)
      .where(and(eq(tasks.businessId, businessId), or(ilike(tasks.title, pattern), ilike(tasks.description, pattern))))
      .limit(perGroup),

    db
      .select({ id: appointments.id, title: appointments.title, startsAt: appointments.startsAt, status: appointments.status })
      .from(appointments)
      .where(and(eq(appointments.businessId, businessId), ilike(appointments.title, pattern)))
      .orderBy(desc(appointments.startsAt))
      .limit(perGroup),

    db
      .select({ id: expenses.id, vendor: expenses.vendor, description: expenses.description, amount: expenses.amountMinor, spentAt: expenses.spentAt })
      .from(expenses)
      .where(and(eq(expenses.businessId, businessId), or(ilike(expenses.vendor, pattern), ilike(expenses.description, pattern))))
      .orderBy(desc(expenses.spentAt))
      .limit(perGroup),
  ]);

  const groups: SearchResultGroup[] = [];

  if (customerRows.length) {
    groups.push({
      type: 'customer',
      label: 'Customers',
      results: customerRows.map((row) => ({
        id: row.id,
        title: row.name,
        subtitle: row.phone ?? row.email,
        href: `/app/customers/${row.id}`,
        meta: money(Number(row.spent)),
      })),
    });
  }
  if (productRows.length) {
    groups.push({
      type: 'product',
      label: 'Products & services',
      results: productRows.map((row) => ({
        id: row.id,
        title: row.name,
        subtitle: row.sku,
        href: `/app/products/${row.id}`,
        meta: `${money(Number(row.price))} · ${row.quantity} in stock`,
      })),
    });
  }
  if (invoiceRows.length) {
    groups.push({
      type: 'invoice',
      label: 'Invoices',
      results: invoiceRows.map((row) => ({
        id: row.id,
        title: row.number,
        subtitle: row.customerName,
        href: `/app/invoices/${row.id}`,
        meta: `${money(Number(row.total) - Number(row.paid))} due`,
      })),
    });
  }
  if (orderRows.length) {
    groups.push({
      type: 'order',
      label: 'Sales',
      results: orderRows.map((row) => ({
        id: row.id,
        title: row.reference,
        subtitle: row.customerName ?? 'Walk-in',
        href: `/app/sales/${row.id}`,
        meta: money(Number(row.total)),
      })),
    });
  }
  if (taskRows.length) {
    groups.push({
      type: 'task',
      label: 'Tasks',
      results: taskRows.map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: row.status,
        href: `/app/tasks`,
        meta: row.dueDate ? `Due ${row.dueDate.toISOString().slice(0, 10)}` : null,
      })),
    });
  }
  if (appointmentRows.length) {
    groups.push({
      type: 'appointment',
      label: 'Appointments',
      results: appointmentRows.map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: row.status,
        href: `/app/appointments`,
        meta: row.startsAt.toISOString().slice(0, 16).replace('T', ' '),
      })),
    });
  }
  if (expenseRows.length) {
    groups.push({
      type: 'expense',
      label: 'Expenses',
      results: expenseRows.map((row) => ({
        id: row.id,
        title: row.vendor ?? row.description ?? 'Expense',
        subtitle: row.description,
        href: `/app/expenses`,
        meta: money(Number(row.amount)),
      })),
    });
  }

  return groups;
}

export { sql };
