import { expenseCategories, expenses, getDb, type Executor } from '@nexa/database';
import type { CreateExpenseInput, ExpenseView } from '@nexa/types';
import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { notFound } from '../lib/errors.js';
import { trackUsage, writeAudit } from '../db/records.js';
import { ownedRow } from '../db/scope.js';
import type { Actor } from './customers.service.js';

async function resolveCategory(
  db: Executor,
  businessId: string,
  categoryId?: string | null,
  categoryName?: string,
): Promise<string | null> {
  if (categoryId) {
    const [found] = await db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(ownedRow(expenseCategories, categoryId, businessId))
      .limit(1);
    if (!found) throw notFound('That expense category');
    return found.id;
  }
  if (!categoryName) return null;
  const [existing] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.businessId, businessId), sql`lower(${expenseCategories.name}) = lower(${categoryName})`))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(expenseCategories).values({ businessId, name: categoryName }).returning();
  return created!.id;
}

export async function listExpenseCategories(businessId: string) {
  const db = await getDb();
  return db
    .select({ id: expenseCategories.id, name: expenseCategories.name, color: expenseCategories.color })
    .from(expenseCategories)
    .where(eq(expenseCategories.businessId, businessId))
    .orderBy(expenseCategories.name);
}

export async function listExpenses(
  businessId: string,
  query: { page: number; pageSize: number; q?: string; categoryId?: string; from?: string; to?: string },
): Promise<{ rows: ExpenseView[]; total: number; totalMinor: number }> {
  const db = await getDb();
  const filters = [eq(expenses.businessId, businessId)];
  if (query.categoryId) filters.push(eq(expenses.categoryId, query.categoryId));
  if (query.from) filters.push(gte(expenses.spentAt, new Date(query.from)));
  if (query.to) filters.push(lte(expenses.spentAt, new Date(query.to)));
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(or(ilike(expenses.vendor, term), ilike(expenses.description, term))!);
  }
  const where = and(...filters)!;

  const [rows, [aggregate]] = await Promise.all([
    db
      .select({ expense: expenses, categoryName: expenseCategories.name })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(where)
      .orderBy(desc(expenses.spentAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::bigint`,
      })
      .from(expenses)
      .where(where),
  ]);

  return {
    rows: rows.map(({ expense, categoryName }) => toExpenseView(expense, categoryName)),
    total: Number(aggregate?.count ?? 0),
    totalMinor: Number(aggregate?.total ?? 0),
  };
}

export async function createExpense(businessId: string, input: CreateExpenseInput, actor: Actor): Promise<ExpenseView> {
  const db = await getDb();
  const created = await db.transaction(async (tx) => {
    const categoryId = await resolveCategory(tx, businessId, input.categoryId, input.categoryName);
    const [row] = await tx
      .insert(expenses)
      .values({
        businessId,
        categoryId,
        amountMinor: input.amountMinor,
        vendor: input.vendor ?? null,
        description: input.description ?? null,
        paymentMethod: input.paymentMethod,
        receiptUrl: input.receiptUrl ?? null,
        recurring: input.recurring ?? false,
        spentAt: input.spentAt ? new Date(input.spentAt) : new Date(),
        createdByUserId: actor.id,
        source: actor.source ?? 'user',
      })
      .returning();

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'expense.created',
      entityType: 'expense',
      entityId: row!.id,
      summary: `${actor.name} recorded an expense of ${input.amountMinor} minor units${input.vendor ? ` to ${input.vendor}` : ''}.`,
      metadata: { amountMinor: input.amountMinor },
    });
    await trackUsage(tx, { businessId, userId: actor.id, name: 'expense_created' });
    return row!;
  });

  const [category] = created.categoryId
    ? await db.select({ name: expenseCategories.name }).from(expenseCategories).where(eq(expenseCategories.id, created.categoryId)).limit(1)
    : [];
  return toExpenseView(created, category?.name ?? null);
}

export async function updateExpense(
  businessId: string,
  expenseId: string,
  input: Partial<CreateExpenseInput>,
  actor: Actor,
): Promise<ExpenseView> {
  const db = await getDb();
  const [existing] = await db.select().from(expenses).where(ownedRow(expenses, expenseId, businessId)).limit(1);
  if (!existing) throw notFound('That expense');

  const updated = await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.amountMinor !== undefined) patch.amountMinor = input.amountMinor;
    if (input.vendor !== undefined) patch.vendor = input.vendor ?? null;
    if (input.description !== undefined) patch.description = input.description ?? null;
    if (input.paymentMethod !== undefined) patch.paymentMethod = input.paymentMethod;
    if (input.receiptUrl !== undefined) patch.receiptUrl = input.receiptUrl ?? null;
    if (input.recurring !== undefined) patch.recurring = input.recurring;
    if (input.spentAt !== undefined) patch.spentAt = new Date(input.spentAt);
    if (input.categoryId !== undefined || input.categoryName !== undefined) {
      patch.categoryId = await resolveCategory(tx, businessId, input.categoryId, input.categoryName);
    }

    const [row] = await tx.update(expenses).set(patch).where(ownedRow(expenses, expenseId, businessId)).returning();
    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: 'expense.updated',
      entityType: 'expense',
      entityId: expenseId,
      summary: `${actor.name} updated an expense.`,
      metadata: { fields: Object.keys(patch).filter((key) => key !== 'updatedAt') },
    });
    return row!;
  });

  const [category] = updated.categoryId
    ? await db.select({ name: expenseCategories.name }).from(expenseCategories).where(eq(expenseCategories.id, updated.categoryId)).limit(1)
    : [];
  return toExpenseView(updated, category?.name ?? null);
}

export async function deleteExpense(businessId: string, expenseId: string, actor: Actor): Promise<void> {
  const db = await getDb();
  const [existing] = await db.select().from(expenses).where(ownedRow(expenses, expenseId, businessId)).limit(1);
  if (!existing) throw notFound('That expense');
  await db.delete(expenses).where(ownedRow(expenses, expenseId, businessId));
  await writeAudit(db, {
    businessId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'expense.deleted',
    entityType: 'expense',
    entityId: expenseId,
    summary: `${actor.name} deleted an expense of ${existing.amountMinor} minor units.`,
    metadata: { amountMinor: Number(existing.amountMinor), vendor: existing.vendor },
  });
}

export async function expenseBreakdown(
  db: Executor,
  businessId: string,
  from: Date,
  to: Date,
): Promise<Array<{ category: string; amountMinor: number; share: number }>> {
  const rows = await db
    .select({
      category: sql<string>`coalesce(${expenseCategories.name}, 'Uncategorised')`,
      amount: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::bigint`,
    })
    .from(expenses)
    .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(and(eq(expenses.businessId, businessId), gte(expenses.spentAt, from), lte(expenses.spentAt, to)))
    .groupBy(sql`coalesce(${expenseCategories.name}, 'Uncategorised')`)
    .orderBy(desc(sql`sum(${expenses.amountMinor})`));

  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  return rows.map((row) => ({
    category: row.category,
    amountMinor: Number(row.amount),
    share: total > 0 ? (Number(row.amount) / total) * 100 : 0,
  }));
}

export async function largestExpenses(
  db: Executor,
  businessId: string,
  from: Date,
  to: Date,
  limit = 5,
): Promise<Array<{ id: string; vendor: string | null; description: string | null; amountMinor: number; spentAt: string }>> {
  const rows = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.businessId, businessId), gte(expenses.spentAt, from), lte(expenses.spentAt, to)))
    .orderBy(desc(expenses.amountMinor))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    vendor: row.vendor,
    description: row.description,
    amountMinor: Number(row.amountMinor),
    spentAt: row.spentAt.toISOString(),
  }));
}

export function toExpenseView(expense: typeof expenses.$inferSelect, categoryName: string | null): ExpenseView {
  return {
    id: expense.id,
    amountMinor: Number(expense.amountMinor),
    categoryId: expense.categoryId,
    categoryName,
    vendor: expense.vendor,
    description: expense.description,
    paymentMethod: expense.paymentMethod,
    receiptUrl: expense.receiptUrl,
    recurring: expense.recurring,
    spentAt: expense.spentAt.toISOString(),
    createdAt: expense.createdAt.toISOString(),
  };
}
