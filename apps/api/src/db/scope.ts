import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Executor } from '@nexa/database';
import { notFound } from '../lib/errors.js';

/**
 * Tenancy enforcement.
 *
 * Every business-owned table carries `business_id`. These helpers are the only
 * sanctioned way to read those tables: a query is constructed *from* the tenant
 * filter rather than having it appended, so forgetting the filter is a type
 * error rather than a silent cross-tenant leak.
 *
 * Cross-tenant reads return 404, never 403 — a 403 would confirm that another
 * business owns a record with that id.
 */

type TenantTable = PgTable & { businessId: PgColumn; id: PgColumn };

/** `WHERE business_id = $1 [AND ...extra]` */
export function inBusiness(table: TenantTable, businessId: string, ...extra: Array<SQL | undefined>): SQL {
  const clauses = [eq(table.businessId, businessId), ...extra.filter(Boolean)] as SQL[];
  return clauses.length === 1 ? clauses[0]! : and(...clauses)!;
}

/** `WHERE id = $1 AND business_id = $2` */
export function ownedRow(table: TenantTable, id: string, businessId: string): SQL {
  return and(eq(table.id, id), eq(table.businessId, businessId))!;
}

/**
 * Loads a single row belonging to the business, or throws 404.
 * Use this instead of a bare `findFirst` on any tenant table.
 */
export async function requireOwned<T>(
  db: Executor,
  table: TenantTable,
  id: string,
  businessId: string,
  label: string,
): Promise<T> {
  const rows = (await db.select().from(table).where(ownedRow(table, id, businessId)).limit(1)) as T[];
  const row = rows[0];
  if (!row) throw notFound(label);
  return row;
}

/** Confirms a referenced id belongs to the tenant before it is stored on a row. */
export async function assertOwned(
  db: Executor,
  table: TenantTable,
  id: string | null | undefined,
  businessId: string,
  label: string,
): Promise<string | null> {
  if (!id) return null;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(ownedRow(table, id, businessId))
    .limit(1);
  if (rows.length === 0) throw notFound(label);
  return id;
}
