import { BUSINESS_GOALS, getCountry, getCurrency } from '@nexa/config';
import {
  businessMembers,
  businesses,
  businessSettings,
  expenseCategories,
  getDb,
  subscriptions,
  users,
  type Business,
  type BusinessSettingsRow,
} from '@nexa/database';
import type { BusinessSettings, BusinessSummary, CreateBusinessInput } from '@nexa/types';
import { eq, sql } from 'drizzle-orm';
import { conflict } from '../lib/errors.js';
import { slugify } from '../lib/crypto.js';
import { emitActivity, trackUsage, writeAudit } from '../db/records.js';

const DEFAULT_EXPENSE_CATEGORIES = [
  'Stock & Supplies',
  'Rent',
  'Utilities',
  'Transport',
  'Marketing',
  'Salaries',
  'Equipment',
  'Fees & Charges',
  'Other',
];

/**
 * Creates a business and everything it needs to be immediately usable:
 * settings seeded from the country's tax rules, an owner membership, a free
 * subscription, and a starter expense chart. Wrapped in one transaction so a
 * half-provisioned workspace can never exist.
 */
export async function createBusiness(
  input: CreateBusinessInput,
  actor: { id: string; name: string },
): Promise<Business> {
  const db = await getDb();
  const country = getCountry(input.country);
  const currency = getCurrency(input.currency ?? country.currency);
  const slug = await uniqueSlug(input.name);

  return db.transaction(async (tx) => {
    const [business] = await tx
      .insert(businesses)
      .values({
        name: input.name,
        slug,
        industry: input.industry || 'Other',
        businessType: input.businessType ?? null,
        country: country.code,
        currency: currency.code,
        locale: country.locale,
        timezone: country.timezone,
        description: input.description ?? null,
        logoUrl: input.logoUrl ?? null,
        phone: input.phone ?? null,
        email: input.email || null,
        website: input.website ?? null,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        region: input.region ?? null,
        postalCode: input.postalCode ?? null,
        socialLinks: input.socialLinks ?? null,
        employeeCount: input.employeeCount ?? null,
        primaryGoal: input.primaryGoal ?? null,
        goals: input.goals ?? [],
        onboardedAt: new Date(),
      })
      .returning();

    await tx.insert(businessSettings).values({
      businessId: business!.id,
      taxEnabled: country.tax.defaultRate > 0,
      taxRate: String(country.tax.defaultRate),
      taxLabel: country.tax.label,
      taxInclusive: country.tax.inclusiveByDefault,
      enabledModules: modulesForGoals(input.primaryGoal, input.goals),
      notificationPreferences: {
        overdue_invoices: true,
        low_stock: true,
        daily_brief: true,
        new_orders: true,
        ai_recommendations: true,
      },
    });

    await tx.insert(businessMembers).values({
      businessId: business!.id,
      userId: actor.id,
      role: 'owner',
      title: 'Owner',
    });

    await tx.insert(subscriptions).values({
      businessId: business!.id,
      plan: 'free',
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await tx
      .insert(expenseCategories)
      .values(DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ businessId: business!.id, name })))
      .onConflictDoNothing();

    await tx.update(users).set({ lastBusinessId: business!.id }).where(eq(users.id, actor.id));

    await emitActivity(tx, {
      businessId: business!.id,
      type: 'business.created',
      title: `${business!.name} is set up on NEXA`,
      description: 'Add your first customer or record a sale to start seeing insights.',
      severity: 'success',
      source: 'system',
      actionLabel: 'Add a customer',
      actionHref: '/app/customers/new',
    });

    await writeAudit(tx, {
      businessId: business!.id,
      actorUserId: actor.id,
      actorName: actor.name,
      action: 'business.created',
      entityType: 'business',
      entityId: business!.id,
      summary: `${actor.name} created ${business!.name}.`,
      metadata: { country: country.code, currency: currency.code, industry: business!.industry },
    });

    await trackUsage(tx, {
      businessId: business!.id,
      userId: actor.id,
      name: 'business_created',
      properties: { industry: business!.industry, country: country.code, goal: input.primaryGoal ?? null },
    });

    return business!;
  });
}

async function uniqueSlug(name: string): Promise<string> {
  const db = await getDb();
  const base = slugify(name) || 'business';
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, candidate)).limit(1);
    if (existing.length === 0) return candidate;
  }
  throw conflict('Could not generate a unique workspace address for that name.');
}

/**
 * Onboarding personalisation: the goals a user picks decide which modules are
 * surfaced first. Every module still exists — this changes emphasis, not
 * capability, so a barber and a retailer run the same core product.
 */
function modulesForGoals(primaryGoal?: string | null, goals?: string[]): string[] {
  const selected = new Set<string>(['dashboard', 'customers', 'sales', 'ai']);
  const picked = [primaryGoal, ...(goals ?? [])].filter(Boolean) as string[];
  for (const goal of picked) {
    const definition = BUSINESS_GOALS.find((entry) => entry.id === goal);
    for (const module of definition?.modules ?? []) selected.add(module);
  }
  if (selected.size <= 4) {
    for (const module of ['products', 'invoices', 'expenses', 'tasks', 'analytics']) selected.add(module);
  }
  return [...selected];
}

export async function updateBusiness(
  businessId: string,
  input: Partial<CreateBusinessInput>,
  actor: { id: string; name: string },
): Promise<Business> {
  const db = await getDb();
  const patch: Partial<typeof businesses.$inferInsert> = { updatedAt: new Date() };

  if (input.name !== undefined) patch.name = input.name;
  if (input.industry !== undefined) patch.industry = input.industry;
  if (input.businessType !== undefined) patch.businessType = input.businessType ?? null;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.logoUrl !== undefined) patch.logoUrl = input.logoUrl ?? null;
  if (input.phone !== undefined) patch.phone = input.phone ?? null;
  if (input.email !== undefined) patch.email = input.email || null;
  if (input.website !== undefined) patch.website = input.website ?? null;
  if (input.addressLine1 !== undefined) patch.addressLine1 = input.addressLine1 ?? null;
  if (input.addressLine2 !== undefined) patch.addressLine2 = input.addressLine2 ?? null;
  if (input.city !== undefined) patch.city = input.city ?? null;
  if (input.region !== undefined) patch.region = input.region ?? null;
  if (input.postalCode !== undefined) patch.postalCode = input.postalCode ?? null;
  if (input.socialLinks !== undefined) patch.socialLinks = input.socialLinks ?? null;
  if (input.employeeCount !== undefined) patch.employeeCount = input.employeeCount ?? null;
  if (input.primaryGoal !== undefined) patch.primaryGoal = input.primaryGoal ?? null;
  if (input.goals !== undefined) patch.goals = input.goals ?? [];

  if (input.country !== undefined) {
    const country = getCountry(input.country);
    patch.country = country.code;
    patch.locale = country.locale;
    patch.timezone = country.timezone;
  }
  // Currency is never changed implicitly by a country change: existing money
  // rows are denominated in the original currency and would be misread.
  if (input.currency !== undefined) patch.currency = getCurrency(input.currency).code;

  const [updated] = await db.update(businesses).set(patch).where(eq(businesses.id, businessId)).returning();

  await writeAudit(db, {
    businessId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'business.updated',
    entityType: 'business',
    entityId: businessId,
    summary: `${actor.name} updated business details.`,
    metadata: { fields: Object.keys(patch).filter((key) => key !== 'updatedAt') },
  });

  return updated!;
}

export async function updateSettings(
  businessId: string,
  input: Record<string, unknown>,
  actor: { id: string; name: string },
): Promise<BusinessSettingsRow> {
  const db = await getDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const allowed = [
    'taxEnabled',
    'taxLabel',
    'taxInclusive',
    'invoicePrefix',
    'invoiceDueDays',
    'invoiceNotes',
    'invoiceFooter',
    'lowStockThreshold',
    'fiscalYearStartMonth',
    'notificationPreferences',
  ];
  for (const key of allowed) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (input.taxRate !== undefined) patch.taxRate = String(input.taxRate);

  const [updated] = await db
    .update(businessSettings)
    .set(patch)
    .where(eq(businessSettings.businessId, businessId))
    .returning();

  await writeAudit(db, {
    businessId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'settings.updated',
    entityType: 'business_settings',
    entityId: businessId,
    summary: `${actor.name} updated business settings.`,
    metadata: { fields: Object.keys(patch).filter((key) => key !== 'updatedAt') },
  });

  return updated!;
}

/** Atomically reserves the next document number for a business. */
export async function nextDocumentNumber(
  tx: Parameters<Parameters<Awaited<ReturnType<typeof getDb>>['transaction']>[0]>[0],
  businessId: string,
  kind: 'invoice' | 'order',
): Promise<string> {
  const column = kind === 'invoice' ? businessSettings.invoiceNextNumber : businessSettings.orderNextNumber;
  const [row] = await tx
    .update(businessSettings)
    .set(kind === 'invoice' ? { invoiceNextNumber: sql`${column} + 1` } : { orderNextNumber: sql`${column} + 1` })
    .where(eq(businessSettings.businessId, businessId))
    .returning();
  const value = kind === 'invoice' ? row!.invoiceNextNumber - 1 : row!.orderNextNumber - 1;
  const prefix = kind === 'invoice' ? row!.invoicePrefix : 'SO';
  return `${prefix}-${value}`;
}

export function toBusinessSummary(business: Business): BusinessSummary {
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    industry: business.industry,
    businessType: business.businessType,
    country: business.country,
    currency: business.currency,
    locale: business.locale,
    timezone: business.timezone,
    logoUrl: business.logoUrl,
    description: business.description,
    phone: business.phone,
    email: business.email,
    website: business.website,
    addressLine1: business.addressLine1,
    city: business.city,
    region: business.region,
    socialLinks: business.socialLinks ?? null,
    employeeCount: business.employeeCount,
    primaryGoal: business.primaryGoal,
    goals: business.goals ?? [],
    isDemo: business.isDemo,
    onboardedAt: business.onboardedAt?.toISOString() ?? null,
    createdAt: business.createdAt.toISOString(),
  };
}

export function toBusinessSettings(row: BusinessSettingsRow): BusinessSettings {
  return {
    taxEnabled: row.taxEnabled,
    taxRate: Number(row.taxRate),
    taxLabel: row.taxLabel,
    taxInclusive: row.taxInclusive,
    invoicePrefix: row.invoicePrefix,
    invoiceDueDays: row.invoiceDueDays,
    invoiceNotes: row.invoiceNotes,
    invoiceFooter: row.invoiceFooter,
    lowStockThreshold: row.lowStockThreshold,
    fiscalYearStartMonth: row.fiscalYearStartMonth,
    timezone: 'UTC',
    notificationPreferences: row.notificationPreferences ?? {},
    enabledModules: row.enabledModules ?? [],
  };
}
