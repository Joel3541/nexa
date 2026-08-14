import { rmSync } from 'node:fs';
import { databaseDir, env } from '@nexa/config';
import {
  activityEvents,
  appointments,
  businessMembers,
  businessSettings,
  businesses,
  closeDb,
  customers as customersTable,
  expenses,
  getDb,
  inventoryMovements,
  invoices,
  orderItems,
  orders,
  payments,
  products as productsTable,
  runMigrations,
  tasks,
  users,
} from '@nexa/database';
import { and, eq, sql } from 'drizzle-orm';
import { DAY_MS } from '../lib/dates.js';
import { hashPassword } from '../lib/crypto.js';
import { registerUser } from '../services/auth.service.js';
import { createBusiness } from '../services/business.service.js';
import { createCustomer, updateCustomer } from '../services/customers.service.js';
import { createExpense } from '../services/expenses.service.js';
import { createInvoice, recordInvoicePayment } from '../services/invoices.service.js';
import { adjustInventory, createProduct } from '../services/products.service.js';
import { createOrder, recordOrderPayment, type TaxContext } from '../services/orders.service.js';
import { createAppointment, createTask } from '../services/work.service.js';
import { runAgentScan } from '../services/activity.service.js';
import {
  CHANNELS,
  CUSTOMER_NAMES,
  CUSTOMER_SOURCES,
  DEMO_BUSINESS,
  DEMO_OWNER,
  DEMO_STAFF,
  EXPENSE_TEMPLATES,
  PAYMENT_METHODS,
  PRODUCTS,
  SERVICES,
  TASK_TEMPLATES,
} from './data.js';

/**
 * Seeds the AURA BEAUTY GH demo workspace.
 *
 * Everything is created through the *same services the API uses*, so the demo
 * data is not a special case: inventory movements, customer rollups, payment
 * records, audit entries and activity cards are all produced exactly as they
 * would be by real usage. Nothing is inserted straight into a table.
 *
 * The generator deliberately shapes history so the analytics and the AI have
 * something true to say:
 *   - weekend trade is heavier than midweek;
 *   - the most recent 30 days dip, driven by returning customers buying less;
 *   - two SKUs trend up, two trend down;
 *   - two products are close to a stock-out;
 *   - a handful of invoices are genuinely overdue;
 *   - roughly a fifth of customers have gone quiet.
 */

/** Deterministic PRNG (mulberry32) so every seed run produces the same story. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(20260814);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const between = (min: number, max: number): number => Math.floor(random() * (max - min + 1)) + min;
const chance = (probability: number): boolean => random() < probability;

function weightedPick<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1]!;
}

const HISTORY_DAYS = 150;
const RECENT_WINDOW = 30;

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const now = new Date();

  if (reset) {
    console.log('[nexa:seed] resetting database…');
    try {
      await closeDb();
    } catch {
      // Nothing was open yet.
    }
    if (env.DATABASE_DRIVER === 'pglite') {
      rmSync(databaseDir(), { recursive: true, force: true });
    } else {
      const db = await getDb();
      await db.execute(sql`drop schema public cascade; create schema public;`);
      await db.execute(sql`drop schema if exists drizzle cascade;`);
      await closeDb();
    }
  }

  await runMigrations();
  const db = await getDb();

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_OWNER.email)).limit(1);
  if (existing && !reset) {
    console.log('[nexa:seed] demo data already present. Re-run with --reset to rebuild it.');
    await closeDb();
    return;
  }

  console.log('[nexa:seed] creating owner and workspace…');
  const { user: owner } = await registerUser(
    { fullName: DEMO_OWNER.fullName, email: DEMO_OWNER.email, password: DEMO_OWNER.password },
    { ip: null, userAgent: 'seed' },
  );
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, owner.id));

  const business = await createBusiness(DEMO_BUSINESS, { id: owner.id, name: owner.fullName });
  await db
    .update(businesses)
    .set({ isDemo: true, createdAt: new Date(now.getTime() - 200 * DAY_MS) })
    .where(eq(businesses.id, business.id));

  // A second member proves role separation is real, not theoretical.
  const [staffUser] = await db
    .insert(users)
    .values({
      email: DEMO_STAFF.email,
      fullName: DEMO_STAFF.fullName,
      passwordHash: await hashPassword(DEMO_STAFF.password),
      emailVerifiedAt: new Date(),
    })
    .returning();
  await db.insert(businessMembers).values({
    businessId: business.id,
    userId: staffUser!.id,
    role: DEMO_STAFF.role,
    title: 'Shop manager',
  });

  const actor = { id: owner.id, name: owner.fullName };
  const tax: TaxContext = { enabled: true, rate: 15, inclusive: true, label: 'VAT' };

  /* ----------------------------- Catalogue ------------------------------ */
  console.log('[nexa:seed] creating products and services…');
  const productIds = new Map<string, string>();
  for (const product of PRODUCTS) {
    const created = await createProduct(
      business.id,
      {
        name: product.name,
        kind: 'physical',
        sku: product.sku,
        categoryName: product.category,
        costPrice: product.costPrice,
        sellingPrice: product.sellingPrice,
        quantity: product.openingStock,
        minStock: product.minStock,
        supplier: product.supplier,
      },
      actor,
      5,
    );
    productIds.set(product.sku, created.id);
  }

  const serviceIds = new Map<string, string>();
  for (const service of SERVICES) {
    const created = await createProduct(
      business.id,
      {
        name: service.name,
        kind: 'service',
        categoryName: service.category,
        description: service.description,
        costPrice: 0,
        sellingPrice: service.price,
        quantity: 0,
        minStock: 0,
        durationMinutes: service.durationMinutes,
        trackInventory: false,
      },
      actor,
      5,
    );
    serviceIds.set(service.name, created.id);
  }

  /* ----------------------------- Customers ------------------------------ */
  console.log('[nexa:seed] creating customers…');
  const customerIds: string[] = [];
  for (const [index, name] of CUSTOMER_NAMES.entries()) {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '.');
    const created = await createCustomer(
      business.id,
      {
        name,
        email: chance(0.72) ? `${slug}@example.com` : undefined,
        phone: `+2332${between(40, 59)}${between(1000000, 9999999)}`,
        city: pick(['Accra', 'Tema', 'Madina', 'Spintex', 'East Legon', 'Kasoa']),
        country: 'GH',
        source: pick(CUSTOMER_SOURCES),
        status: 'active',
      },
      actor,
    );
    customerIds.push(created.id);

    // Stagger sign-up dates so "new customers this period" is meaningful.
    const joinedDaysAgo = index < 30 ? between(60, 190) : between(2, 55);
    await db
      .update(customersTable)
      .set({ createdAt: new Date(now.getTime() - joinedDaysAgo * DAY_MS) })
      .where(eq(customersTable.id, created.id));
  }

  /* ------------------------------- Orders ------------------------------- */
  console.log('[nexa:seed] generating sales history…');
  const physical = PRODUCTS.map((product) => ({ ...product, id: productIds.get(product.sku)! }));
  const services = SERVICES.map((service) => ({ ...service, id: serviceIds.get(service.name)! }));

  // Loyal customers buy repeatedly; the "lapsing" group stops entirely partway
  // through the history, so they cross the 60-day inactivity line for real.
  const loyal = customerIds.slice(0, 14);
  const lapsing = customerIds.slice(14, 32);
  const occasional = customerIds.slice(32);
  const LAPSE_AFTER_DAY = 75;

  let orderCount = 0;
  for (let dayOffset = HISTORY_DAYS; dayOffset >= 0; dayOffset -= 1) {
    const date = new Date(now.getTime() - dayOffset * DAY_MS);
    const weekday = date.getUTCDay();
    if (weekday === 0) continue; // Closed on Sundays.

    const isRecent = dayOffset < RECENT_WINDOW;
    const stillActive = dayOffset > LAPSE_AFTER_DAY;
    const weekendBoost = weekday === 6 || weekday === 5 ? 1.55 : 1;
    // The recent dip is driven by returning customers buying less, which is
    // exactly what analyze_sales surfaces when asked why revenue fell.
    const recentDrag = isRecent ? 0.72 : 1;
    const target = Math.max(0, Math.round(5.5 * weekendBoost * recentDrag + (random() * 2 - 0.8)));

    for (let n = 0; n < target; n += 1) {
      const buyerPool = stillActive
        ? chance(0.4)
          ? loyal
          : chance(0.55)
            ? lapsing
            : occasional
        : chance(0.55)
          ? loyal
          : occasional;
      const customerId = pick(buyerPool);

      const lineCount = chance(0.42) ? 2 : chance(0.22) ? 3 : 1;
      const items: Array<{ productId: string; quantity: number }> = [];
      const chosen = new Set<string>();

      for (let l = 0; l < lineCount; l += 1) {
        const useService = chance(0.12);
        if (useService) {
          const service = weightedPick(services);
          if (chosen.has(service.id)) continue;
          chosen.add(service.id);
          items.push({ productId: service.id, quantity: 1 });
          continue;
        }
        // Trend weighting: rising SKUs get more likely over time, falling ones
        // less, so momentum analysis has a genuine signal to find.
        const pool = physical.map((product) => {
          let weight = product.weight;
          if (product.trend === 'rising') weight *= isRecent ? 2.1 : 0.8;
          if (product.trend === 'falling') weight *= isRecent ? 0.35 : 1.25;
          return { ...product, weight };
        });
        const product = weightedPick(pool);
        if (chosen.has(product.id)) continue;
        chosen.add(product.id);
        items.push({ productId: product.id, quantity: chance(0.18) ? 2 : 1 });
      }
      if (items.length === 0) continue;

      // Most trade is paid on the spot; a minority runs on account and becomes
      // the receivables the finance agent chases.
      const onAccount = chance(0.14);
      // Trading hours, but never stamped later than "now" — a sale in the
      // future would read as a negative age everywhere downstream.
      const occurredAt = new Date(Math.min(date.getTime() + between(9, 19) * 60 * 60 * 1000, now.getTime() - 60_000));

      try {
        const order = await createOrder(
          business.id,
          {
            customerId,
            items: items.map((item) => ({ ...item, discountMinor: 0 })),
            discountMinor: chance(0.1) ? between(500, 3000) : 0,
            status: 'confirmed',
            channel: pick(CHANNELS),
            occurredAt: occurredAt.toISOString(),
          },
          actor,
          tax,
        );

        if (onAccount) {
          await createAccountInvoice(business.id, order.id, customerId, order, actor, tax, occurredAt, now);
        } else {
          // Settled at the counter — recorded as a real payment, not a flag.
          await recordOrderPayment(
            business.id,
            order.id,
            { amountMinor: order.totalMinor, method: pick(PAYMENT_METHODS), receivedAt: occurredAt.toISOString() },
            actor,
          );
        }
        orderCount += 1;
      } catch {
        // A line went out of stock — realistic, and simply skipped.
      }
    }
  }

  /* ------------------------------ Restocks ------------------------------ */
  console.log('[nexa:seed] recording restocks…');
  for (const product of physical) {
    const [row] = await db
      .select({ quantity: productsTable.quantity })
      .from(productsTable)
      .where(and(eq(productsTable.id, product.id), eq(productsTable.businessId, business.id)))
      .limit(1);
    const quantity = row?.quantity ?? 0;

    // The "scarce" SKUs are left with roughly a week of cover — computed from
    // the velocity they actually achieved in the generated history, so the
    // stock-out projection the AI reports is a real inference, not a fixture.
    let targetStock: number;
    if (product.scarce) {
      const [sold] = await db
        .select({ units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(
          and(
            eq(orderItems.businessId, business.id),
            eq(orderItems.productId, product.id),
            sql`${orders.occurredAt} >= ${new Date(now.getTime() - 30 * DAY_MS)}`,
          ),
        );
      const dailyVelocity = Number(sold?.units ?? 0) / 30;
      targetStock = dailyVelocity > 0 ? Math.max(2, Math.ceil(dailyVelocity * between(6, 9))) : between(4, 8);
    } else {
      targetStock = Math.max(product.minStock * 3, between(45, 110));
    }
    const delta = targetStock - quantity;
    if (delta === 0) continue;
    await adjustInventory(
      business.id,
      product.id,
      {
        quantityDelta: delta,
        reason: delta > 0 ? 'purchase' : 'adjustment',
        unitCost: product.costPrice,
        note: delta > 0 ? 'Supplier restock' : 'Stock count correction',
      },
      actor,
      5,
    );
  }

  /* ------------------------------ Expenses ------------------------------ */
  console.log('[nexa:seed] recording expenses…');
  for (const template of EXPENSE_TEMPLATES) {
    for (let dayOffset = HISTORY_DAYS; dayOffset >= 0; dayOffset -= template.cadenceDays) {
      const spentAt = new Date(now.getTime() - dayOffset * DAY_MS);
      await createExpense(
        business.id,
        {
          amountMinor: between(template.min, template.max),
          categoryName: template.category,
          vendor: template.vendor,
          description: template.description,
          spentAt: spentAt.toISOString(),
          paymentMethod: pick(PAYMENT_METHODS),
          recurring: template.cadenceDays >= 28,
        },
        actor,
      );
    }
  }

  /* ------------------------- Tasks & appointments ------------------------ */
  console.log('[nexa:seed] adding tasks and appointments…');
  for (const template of TASK_TEMPLATES) {
    await createTask(
      business.id,
      {
        title: template.title,
        priority: template.priority,
        status: 'todo',
        recurrence: 'none',
        dueDate: new Date(now.getTime() + template.dueInDays * DAY_MS).toISOString(),
      },
      actor,
    );
  }
  await createTask(
    business.id,
    { title: 'Weekly stock check', priority: 'medium', status: 'completed', recurrence: 'weekly', dueDate: new Date(now.getTime() - 2 * DAY_MS).toISOString() },
    actor,
  );

  for (let i = 0; i < 9; i += 1) {
    const service = pick(SERVICES);
    const startsAt = new Date(now.getTime() + between(0, 9) * DAY_MS + between(9, 17) * 60 * 60 * 1000);
    await createAppointment(
      business.id,
      {
        title: service.name,
        customerId: pick(customerIds),
        productId: serviceIds.get(service.name)!,
        startsAt: startsAt.toISOString(),
        durationMinutes: service.durationMinutes,
        status: i < 6 ? 'scheduled' : 'confirmed',
        location: 'Treatment room, Osu',
      },
      actor,
    );
  }

  /* -------------------------- Lapsed customers -------------------------- */
  // Tag the quiet segment so the CRM shows intent, not just derived state.
  for (const customerId of lapsing.slice(0, 8)) {
    await updateCustomer(business.id, customerId, { tags: ['was-regular'] }, actor);
  }
  for (const customerId of loyal.slice(0, 5)) {
    await updateCustomer(business.id, customerId, { tags: ['vip'] }, actor);
  }

  // Historical noise shouldn't greet a first-time viewer as unread. Mark
  // everything generated so far as seen, then let the agents raise today's.
  await db
    .update(activityEvents)
    .set({ readAt: new Date() })
    .where(eq(activityEvents.businessId, business.id));

  console.log('[nexa:seed] running the monitoring agents…');
  const [businessRow] = await db.select().from(businesses).where(eq(businesses.id, business.id)).limit(1);
  const [settingsRow] = await db
    .select()
    .from(businessSettings)
    .where(eq(businessSettings.businessId, business.id))
    .limit(1);
  if (businessRow && settingsRow) {
    await runAgentScan(businessRow, settingsRow, now);
  }

  const tally = async (
    label: string,
    query: Promise<Array<{ count: number }>>,
  ): Promise<[string, number]> => [label, Number((await query)[0]?.count ?? 0)];

  const counts = Object.fromEntries(
    await Promise.all([
      tally('customers', db.select({ count: sql<number>`count(*)::int` }).from(customersTable).where(eq(customersTable.businessId, business.id))),
      tally('products', db.select({ count: sql<number>`count(*)::int` }).from(productsTable).where(eq(productsTable.businessId, business.id))),
      tally('orders', db.select({ count: sql<number>`count(*)::int` }).from(orders).where(eq(orders.businessId, business.id))),
      tally('invoices', db.select({ count: sql<number>`count(*)::int` }).from(invoices).where(eq(invoices.businessId, business.id))),
      tally('payments', db.select({ count: sql<number>`count(*)::int` }).from(payments).where(eq(payments.businessId, business.id))),
      tally('expenses', db.select({ count: sql<number>`count(*)::int` }).from(expenses).where(eq(expenses.businessId, business.id))),
      tally('inventory movements', db.select({ count: sql<number>`count(*)::int` }).from(inventoryMovements).where(eq(inventoryMovements.businessId, business.id))),
      tally('tasks', db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.businessId, business.id))),
      tally('appointments', db.select({ count: sql<number>`count(*)::int` }).from(appointments).where(eq(appointments.businessId, business.id))),
    ]),
  );

  const [revenueRow] = await db
    .select({ total: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::bigint` })
    .from(orders)
    .where(eq(orders.businessId, business.id));

  console.log('\n[nexa:seed] AURA BEAUTY GH is ready.\n');
  console.table({ ...counts, 'revenue (GHS)': (Number(revenueRow?.total ?? 0) / 100).toFixed(2) });
  console.log(`\n  Sign in:  ${DEMO_OWNER.email}  /  ${DEMO_OWNER.password}   (owner)`);
  console.log(`            ${DEMO_STAFF.email}  /  ${DEMO_STAFF.password}   (manager — reduced permissions)\n`);
  console.log(`  Orders generated: ${orderCount}\n`);

  await closeDb();
}

/**
 * Converts an unpaid order into an invoice, and settles some of them so the
 * receivables picture contains a genuine mix of paid, partial and overdue.
 */
async function createAccountInvoice(
  businessId: string,
  orderId: string,
  customerId: string,
  order: { items: Array<{ productId: string | null; name: string; quantity: number; unitPriceMinor: number }>; totalMinor: number },
  actor: { id: string; name: string },
  tax: TaxContext,
  occurredAt: Date,
  now: Date,
): Promise<void> {
  const dueDate = new Date(occurredAt.getTime() + 14 * DAY_MS);
  const invoice = await createInvoice(
    businessId,
    {
      customerId,
      orderId,
      items: order.items.map((item) => ({
        productId: item.productId ?? undefined,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPriceMinor,
        discountMinor: 0,
      })),
      discountMinor: 0,
      issueDate: occurredAt.toISOString(),
      dueDate: dueDate.toISOString(),
      status: 'sent',
    },
    actor,
    { ...tax, currency: 'GHS', locale: 'en-GH', businessName: 'Aura Beauty GH', dueDays: 14 },
  );

  const isPastDue = dueDate.getTime() < now.getTime();
  // Most older invoices get paid; a deliberate minority stays outstanding.
  if (isPastDue && chance(0.68)) {
    await recordInvoicePayment(
      businessId,
      invoice.id,
      {
        amountMinor: invoice.totalMinor,
        method: 'mobile_money',
        receivedAt: new Date(dueDate.getTime() - between(0, 6) * DAY_MS).toISOString(),
      },
      actor,
    );
  } else if (chance(0.25) && invoice.totalMinor > 4000) {
    await recordInvoicePayment(
      businessId,
      invoice.id,
      {
        amountMinor: Math.floor(invoice.totalMinor / 2),
        method: 'mobile_money',
        note: 'Part payment',
        receivedAt: new Date(occurredAt.getTime() + 5 * DAY_MS).toISOString(),
      },
      actor,
    );
  }
}

main().catch((error: unknown) => {
  console.error('[nexa:seed] failed:', error);
  process.exit(1);
});
