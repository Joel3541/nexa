import {
  getDb,
  inventoryMovements,
  orderItems,
  orders,
  productCategories,
  products,
  type Executor,
  type Product,
} from '@nexa/database';
import type { CreateProductInput, InventoryMovementView, ListProductsInput, ProductView } from '@nexa/types';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { DAY_MS } from '../lib/dates.js';
import { emitActivity, trackUsage, writeAudit } from '../db/records.js';
import { ownedRow } from '../db/scope.js';
import type { Actor } from './customers.service.js';

const VELOCITY_WINDOW_DAYS = 30;

/* -------------------------------------------------------------------------- */
/* Sales velocity + stock projection                                           */
/* -------------------------------------------------------------------------- */

export interface VelocityRow {
  productId: string;
  unitsSold: number;
  revenueMinor: number;
  /** Number of distinct days with a sale — the basis for our confidence rating. */
  activeDays: number;
}

export async function salesVelocity(
  db: Executor,
  businessId: string,
  productIds: string[],
  windowDays = VELOCITY_WINDOW_DAYS,
  now = new Date(),
): Promise<Map<string, VelocityRow>> {
  const map = new Map<string, VelocityRow>();
  if (productIds.length === 0) return map;
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await db
    .select({
      productId: orderItems.productId,
      units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${orderItems.totalMinor}), 0)::bigint`,
      activeDays: sql<number>`count(distinct date_trunc('day', ${orders.occurredAt}))::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.businessId, businessId),
        inArray(orderItems.productId, productIds),
        sql`${orders.occurredAt} >= ${since}`,
        sql`${orders.status} <> 'cancelled'`,
      ),
    )
    .groupBy(orderItems.productId);

  for (const row of rows) {
    if (!row.productId) continue;
    map.set(row.productId, {
      productId: row.productId,
      unitsSold: Number(row.units),
      revenueMinor: Number(row.revenue),
      activeDays: Number(row.activeDays),
    });
  }
  return map;
}

/**
 * Projects days of stock cover from recent demand.
 *
 * Deliberately conservative about certainty: confidence drops when the estimate
 * rests on very few selling days, and the basis is returned so the UI and the
 * AI can state the assumption rather than presenting a guess as a fact.
 */
export function projectStock(
  quantity: number,
  velocity: VelocityRow | undefined,
  windowDays = VELOCITY_WINDOW_DAYS,
): { dailyVelocity: number; daysRemaining: number | null; confidence: 'high' | 'medium' | 'low' | null; basis: string } {
  const unitsSold = velocity?.unitsSold ?? 0;
  if (unitsSold <= 0) {
    return { dailyVelocity: 0, daysRemaining: null, confidence: null, basis: 'no sales in the last 30 days' };
  }
  const dailyVelocity = unitsSold / windowDays;
  const daysRemaining = dailyVelocity > 0 ? Math.max(0, Math.floor(quantity / dailyVelocity)) : null;
  const activeDays = velocity?.activeDays ?? 0;
  const confidence = activeDays >= 10 ? 'high' : activeDays >= 4 ? 'medium' : 'low';
  return {
    dailyVelocity,
    daysRemaining,
    confidence,
    basis: `${unitsSold} units across ${activeDays} selling ${activeDays === 1 ? 'day' : 'days'}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

export async function listProducts(
  businessId: string,
  query: ListProductsInput,
  lowStockThreshold: number,
  now = new Date(),
): Promise<{ rows: ProductView[]; total: number }> {
  const db = await getDb();
  const filters = [eq(products.businessId, businessId)];

  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(or(ilike(products.name, term), ilike(products.sku, term), ilike(products.description, term))!);
  }
  if (query.kind) filters.push(eq(products.kind, query.kind));
  if (query.categoryId) filters.push(eq(products.categoryId, query.categoryId));
  if (query.active !== undefined) filters.push(eq(products.active, query.active));
  if (query.lowStockOnly) {
    filters.push(
      eq(products.trackInventory, true),
      sql`${products.quantity} <= greatest(${products.minStock}, ${lowStockThreshold})`,
    );
  }

  const where = and(...filters)!;
  const orderBy = {
    name: asc(products.name),
    recent: desc(products.createdAt),
    stock: asc(products.quantity),
    price: desc(products.sellingPriceMinor),
    best_selling: desc(products.createdAt),
  }[query.sort];

  const [rows, [countRow]] = await Promise.all([
    db
      .select({ product: products, categoryName: productCategories.name })
      .from(products)
      .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
      .where(where)
      .orderBy(orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(products).where(where),
  ]);

  const velocity = await salesVelocity(
    db,
    businessId,
    rows.map((row) => row.product.id),
    VELOCITY_WINDOW_DAYS,
    now,
  );

  let views = rows.map((row) => toProductView(row.product, row.categoryName, velocity.get(row.product.id), lowStockThreshold));
  if (query.sort === 'best_selling') views = views.sort((a, b) => b.unitsSold30d - a.unitsSold30d);

  return { rows: views, total: Number(countRow?.count ?? 0) };
}

export async function getProduct(businessId: string, productId: string, lowStockThreshold: number): Promise<ProductView> {
  const db = await getDb();
  const [row] = await db
    .select({ product: products, categoryName: productCategories.name })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(ownedRow(products, productId, businessId))
    .limit(1);
  if (!row) throw notFound('That product');
  const velocity = await salesVelocity(db, businessId, [productId]);
  return toProductView(row.product, row.categoryName, velocity.get(productId), lowStockThreshold);
}

export async function listCategories(businessId: string) {
  const db = await getDb();
  return db
    .select({ id: productCategories.id, name: productCategories.name })
    .from(productCategories)
    .where(eq(productCategories.businessId, businessId))
    .orderBy(asc(productCategories.name));
}

export async function lowStockProducts(
  businessId: string,
  lowStockThreshold: number,
  limit = 20,
  now = new Date(),
): Promise<ProductView[]> {
  const db = await getDb();
  const rows = await db
    .select({ product: products, categoryName: productCategories.name })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(
      and(
        eq(products.businessId, businessId),
        eq(products.trackInventory, true),
        eq(products.active, true),
        eq(products.kind, 'physical'),
        sql`${products.quantity} <= greatest(${products.minStock}, ${lowStockThreshold})`,
      ),
    )
    .orderBy(asc(products.quantity))
    .limit(limit);

  const velocity = await salesVelocity(db, businessId, rows.map((r) => r.product.id), VELOCITY_WINDOW_DAYS, now);
  return rows.map((row) => toProductView(row.product, row.categoryName, velocity.get(row.product.id), lowStockThreshold));
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

async function resolveCategory(
  db: Executor,
  businessId: string,
  categoryId?: string | null,
  categoryName?: string,
): Promise<string | null> {
  if (categoryId) {
    const [found] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(ownedRow(productCategories, categoryId, businessId))
      .limit(1);
    if (!found) throw notFound('That category');
    return found.id;
  }
  if (!categoryName) return null;
  const [existing] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(and(eq(productCategories.businessId, businessId), sql`lower(${productCategories.name}) = lower(${categoryName})`))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(productCategories).values({ businessId, name: categoryName }).returning();
  return created!.id;
}

export async function createProduct(
  businessId: string,
  input: CreateProductInput,
  actor: Actor,
  lowStockThreshold: number,
): Promise<ProductView> {
  const db = await getDb();

  if (input.sku) {
    const [existing] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.businessId, businessId), sql`lower(${products.sku}) = lower(${input.sku})`))
      .limit(1);
    if (existing) throw conflict('That SKU is already in use.', { sku: 'Already used by another product' });
  }

  const product = await db.transaction(async (tx) => {
    const categoryId = await resolveCategory(tx, businessId, input.categoryId, input.categoryName);
    const isService = input.kind === 'service';
    const trackInventory = input.trackInventory ?? !isService;

    const [row] = await tx
      .insert(products)
      .values({
        businessId,
        name: input.name,
        kind: input.kind,
        sku: input.sku ?? null,
        description: input.description ?? null,
        categoryId,
        costPriceMinor: input.costPrice,
        sellingPriceMinor: input.sellingPrice,
        quantity: isService ? 0 : input.quantity,
        minStock: isService ? 0 : input.minStock,
        trackInventory,
        supplier: input.supplier ?? null,
        durationMinutes: input.durationMinutes ?? null,
        active: input.active ?? true,
      })
      .returning();

    if (trackInventory && input.quantity !== 0) {
      await tx.insert(inventoryMovements).values({
        businessId,
        productId: row!.id,
        quantityDelta: input.quantity,
        balanceAfter: input.quantity,
        reason: 'opening_stock',
        unitCostMinor: input.costPrice,
        note: 'Opening stock recorded when the product was created.',
        actorUserId: actor.id,
        source: actor.source ?? 'user',
      });
    }

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'product.created',
      entityType: 'product',
      entityId: row!.id,
      summary: `${actor.name} added ${input.kind} "${row!.name}".`,
    });
    await trackUsage(tx, { businessId, userId: actor.id, name: 'product_created', properties: { kind: input.kind } });
    return row!;
  });

  return getProduct(businessId, product.id, lowStockThreshold);
}

export async function updateProduct(
  businessId: string,
  productId: string,
  input: Record<string, unknown>,
  actor: Actor,
  lowStockThreshold: number,
): Promise<ProductView> {
  const db = await getDb();
  const [existing] = await db.select().from(products).where(ownedRow(products, productId, businessId)).limit(1);
  if (!existing) throw notFound('That product');

  await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'kind', 'sku', 'description', 'supplier', 'durationMinutes', 'trackInventory', 'active', 'minStock'] as const) {
      if (input[key] !== undefined) patch[key] = input[key] ?? null;
    }
    if (input.costPrice !== undefined) patch.costPriceMinor = input.costPrice;
    if (input.sellingPrice !== undefined) patch.sellingPriceMinor = input.sellingPrice;
    if (input.categoryId !== undefined || input.categoryName !== undefined) {
      patch.categoryId = await resolveCategory(
        tx,
        businessId,
        input.categoryId as string | null,
        input.categoryName as string | undefined,
      );
    }

    await tx.update(products).set(patch).where(ownedRow(products, productId, businessId));
    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'product.updated',
      entityType: 'product',
      entityId: productId,
      summary: `${actor.name} updated "${existing.name}".`,
      metadata: { fields: Object.keys(patch).filter((key) => key !== 'updatedAt') },
    });
  });

  return getProduct(businessId, productId, lowStockThreshold);
}

export async function deleteProduct(businessId: string, productId: string, actor: Actor): Promise<void> {
  const db = await getDb();
  const [existing] = await db.select().from(products).where(ownedRow(products, productId, businessId)).limit(1);
  if (!existing) throw notFound('That product');

  const [sold] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orderItems)
    .where(and(eq(orderItems.businessId, businessId), eq(orderItems.productId, productId)));

  // Sold products are archived, never deleted — deleting would rewrite history.
  if (Number(sold?.count ?? 0) > 0) {
    await db.update(products).set({ active: false, updatedAt: new Date() }).where(ownedRow(products, productId, businessId));
    await writeAudit(db, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: 'product.archived',
      entityType: 'product',
      entityId: productId,
      summary: `${actor.name} archived "${existing.name}" (it appears in past sales, so it was not deleted).`,
    });
    return;
  }

  await db.delete(products).where(ownedRow(products, productId, businessId));
  await writeAudit(db, {
    businessId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'product.deleted',
    entityType: 'product',
    entityId: productId,
    summary: `${actor.name} deleted "${existing.name}".`,
  });
}

export async function adjustInventory(
  businessId: string,
  productId: string,
  input: { quantityDelta: number; reason: string; unitCost?: number; note?: string },
  actor: Actor,
  lowStockThreshold: number,
): Promise<ProductView> {
  const db = await getDb();

  await db.transaction(async (tx) => {
    const [product] = await tx.select().from(products).where(ownedRow(products, productId, businessId)).limit(1);
    if (!product) throw notFound('That product');
    if (!product.trackInventory) throw badRequest('This item does not track inventory.');

    const balanceAfter = product.quantity + input.quantityDelta;
    if (balanceAfter < 0) {
      throw badRequest(`That would take stock to ${balanceAfter}. Only ${product.quantity} in stock.`);
    }

    await tx
      .update(products)
      .set({ quantity: balanceAfter, updatedAt: new Date() })
      .where(ownedRow(products, productId, businessId));

    await tx.insert(inventoryMovements).values({
      businessId,
      productId,
      quantityDelta: input.quantityDelta,
      balanceAfter,
      reason: input.reason as 'adjustment',
      unitCostMinor: input.unitCost ?? null,
      note: input.note ?? null,
      actorUserId: actor.id,
      source: actor.source ?? 'user',
    });

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'inventory.adjusted',
      entityType: 'product',
      entityId: productId,
      summary: `${actor.name} adjusted "${product.name}" by ${input.quantityDelta > 0 ? '+' : ''}${input.quantityDelta} (${input.reason}).`,
      metadata: { from: product.quantity, to: balanceAfter, reason: input.reason },
    });

    if (balanceAfter <= Math.max(product.minStock, lowStockThreshold)) {
      await emitActivity(tx, {
        businessId,
        type: 'inventory.low_stock',
        severity: balanceAfter === 0 ? 'critical' : 'warning',
        title:
          balanceAfter === 0
            ? `${product.name} is out of stock`
            : `${product.name} is low — ${balanceAfter} left`,
        description: `Minimum stock level is ${Math.max(product.minStock, lowStockThreshold)}.`,
        entityType: 'product',
        entityId: productId,
        actionLabel: 'Restock',
        actionHref: `/app/products/${productId}`,
        dedupeKey: `low_stock:${productId}:${balanceAfter}`,
      });
    }
  });

  return getProduct(businessId, productId, lowStockThreshold);
}

export async function listMovements(businessId: string, productId: string, limit = 50): Promise<InventoryMovementView[]> {
  const db = await getDb();
  const rows = await db
    .select({ movement: inventoryMovements, productName: products.name })
    .from(inventoryMovements)
    .innerJoin(products, eq(products.id, inventoryMovements.productId))
    .where(and(eq(inventoryMovements.businessId, businessId), eq(inventoryMovements.productId, productId)))
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(limit);

  return rows.map(({ movement, productName }) => ({
    id: movement.id,
    productId: movement.productId,
    productName,
    quantityDelta: movement.quantityDelta,
    balanceAfter: movement.balanceAfter,
    reason: movement.reason,
    unitCostMinor: movement.unitCostMinor === null ? null : Number(movement.unitCostMinor),
    note: movement.note,
    createdAt: movement.createdAt.toISOString(),
    actorName: null,
  }));
}

export async function inventoryValuation(businessId: string): Promise<{
  productCount: number;
  trackedCount: number;
  totalStockValueMinor: number;
  outOfStockCount: number;
}> {
  const db = await getDb();
  const [row] = await db
    .select({
      productCount: sql<number>`count(*)::int`,
      trackedCount: sql<number>`count(*) filter (where ${products.trackInventory})::int`,
      value: sql<number>`coalesce(sum(${products.quantity} * ${products.costPriceMinor}) filter (where ${products.trackInventory}), 0)::bigint`,
      outOfStock: sql<number>`count(*) filter (where ${products.trackInventory} and ${products.quantity} <= 0)::int`,
    })
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.active, true)));

  return {
    productCount: Number(row?.productCount ?? 0),
    trackedCount: Number(row?.trackedCount ?? 0),
    totalStockValueMinor: Number(row?.value ?? 0),
    outOfStockCount: Number(row?.outOfStock ?? 0),
  };
}

export function toProductView(
  product: Product,
  categoryName: string | null,
  velocity: VelocityRow | undefined,
  lowStockThreshold: number,
): ProductView {
  const cost = Number(product.costPriceMinor);
  const price = Number(product.sellingPriceMinor);
  const projection = projectStock(product.quantity, velocity);
  const effectiveMin = Math.max(product.minStock, lowStockThreshold);

  return {
    id: product.id,
    name: product.name,
    kind: product.kind,
    sku: product.sku,
    description: product.description,
    categoryId: product.categoryId,
    categoryName,
    costPriceMinor: cost,
    sellingPriceMinor: price,
    marginMinor: price - cost,
    marginPercent: price > 0 ? ((price - cost) / price) * 100 : null,
    quantity: product.quantity,
    minStock: product.minStock,
    trackInventory: product.trackInventory,
    supplier: product.supplier,
    durationMinutes: product.durationMinutes,
    active: product.active,
    unitsSold30d: velocity?.unitsSold ?? 0,
    revenue30dMinor: velocity?.revenueMinor ?? 0,
    daysOfStockRemaining: projection.daysRemaining,
    stockConfidence: projection.confidence,
    isLowStock: product.trackInventory && product.kind === 'physical' && product.quantity <= effectiveMin,
    createdAt: product.createdAt.toISOString(),
  };
}
