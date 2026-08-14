import { COUNTRY_LIST, CURRENCY_LIST, BUSINESS_GOALS, BUSINESS_INDUSTRIES } from '@nexa/config';
import { businessMembers, getDb, users } from '@nexa/database';
import {
  ROLE_RANK,
  createBusinessSchema,
  inviteMemberSchema,
  updateBusinessSchema,
  updateBusinessSettingsSchema,
  updateMemberSchema,
} from '@nexa/types';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { handler, param, parse } from '../lib/http.js';
import { requireAuth, requireBusiness, requirePermission } from '../middleware/auth.js';
import { getAuth, getTenant } from '../middleware/context.js';
import { writeAudit } from '../db/records.js';
import {
  buildSessionContext,
  createSession,
} from '../services/auth.service.js';
import {
  createBusiness,
  toBusinessSettings,
  toBusinessSummary,
  updateBusiness,
  updateSettings,
} from '../services/business.service.js';

export const businessRouter: Router = Router();

/** Reference data for onboarding forms. Public — no tenant needed. */
businessRouter.get('/reference', (_req, res) => {
  res.json({
    countries: COUNTRY_LIST,
    currencies: CURRENCY_LIST,
    industries: BUSINESS_INDUSTRIES,
    goals: BUSINESS_GOALS,
  });
});

businessRouter.post(
  '/',
  requireAuth,
  handler(async (req, res) => {
    const auth = getAuth(req);
    const input = parse(createBusinessSchema, req.body);
    const business = await createBusiness(input, { id: auth.user.id, name: auth.user.fullName });
    res.status(201).json(await buildSessionContext(auth.user, business.id));
  }),
);

businessRouter.get(
  '/',
  requireAuth,
  requireBusiness,
  handler(async (req, res) => {
    const tenant = getTenant(req);
    res.json({
      business: toBusinessSummary(tenant.business),
      settings: toBusinessSettings(tenant.settings),
      role: tenant.role,
      permissions: tenant.permissions,
    });
  }),
);

businessRouter.patch(
  '/',
  requireAuth,
  requireBusiness,
  requirePermission('business:update'),
  handler(async (req, res) => {
    const auth = getAuth(req);
    const tenant = getTenant(req);
    const input = parse(updateBusinessSchema, req.body);
    const business = await updateBusiness(tenant.business.id, input, { id: auth.user.id, name: auth.user.fullName });
    res.json(toBusinessSummary(business));
  }),
);

businessRouter.patch(
  '/settings',
  requireAuth,
  requireBusiness,
  requirePermission('settings:manage'),
  handler(async (req, res) => {
    const auth = getAuth(req);
    const tenant = getTenant(req);
    const input = parse(updateBusinessSettingsSchema, req.body);
    const settings = await updateSettings(tenant.business.id, input, { id: auth.user.id, name: auth.user.fullName });
    res.json(toBusinessSettings(settings));
  }),
);

/** Switches the active workspace and remembers it for the next sign-in. */
businessRouter.post(
  '/switch/:businessId',
  requireAuth,
  handler(async (req, res) => {
    const auth = getAuth(req);
    const businessId = param(req, 'businessId');
    const db = await getDb();
    const [membership] = await db
      .select({ id: businessMembers.id })
      .from(businessMembers)
      .where(
        and(
          eq(businessMembers.userId, auth.user.id),
          eq(businessMembers.businessId, businessId),
          eq(businessMembers.active, true),
        ),
      )
      .limit(1);
    if (!membership) throw notFound('That business');

    await db.update(users).set({ lastBusinessId: businessId }).where(eq(users.id, auth.user.id));
    res.json(await buildSessionContext({ ...auth.user, lastBusinessId: businessId }, businessId));
  }),
);

businessRouter.get(
  '/members',
  requireAuth,
  requireBusiness,
  requirePermission('members:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const db = await getDb();
    const rows = await db
      .select({ member: businessMembers, user: users })
      .from(businessMembers)
      .innerJoin(users, eq(users.id, businessMembers.userId))
      .where(eq(businessMembers.businessId, tenant.business.id));

    res.json(
      rows.map(({ member, user }) => ({
        id: member.id,
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        role: member.role,
        title: member.title,
        active: member.active,
        joinedAt: member.joinedAt.toISOString(),
      })),
    );
  }),
);

/**
 * Adds a teammate.
 *
 * Two guards matter here: you cannot grant a role at or above your own (no
 * privilege escalation), and an existing NEXA user is linked rather than
 * duplicated. A brand-new user is created with an unusable password and must
 * set one through the reset flow.
 */
businessRouter.post(
  '/members',
  requireAuth,
  requireBusiness,
  requirePermission('members:manage'),
  handler(async (req, res) => {
    const auth = getAuth(req);
    const tenant = getTenant(req);
    const input = parse(inviteMemberSchema, req.body);

    if (ROLE_RANK[input.role] >= ROLE_RANK[tenant.role]) {
      throw forbidden('You cannot grant a role equal to or above your own.');
    }

    const db = await getDb();
    const [existingUser] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    let userId = existingUser?.id;

    if (!userId) {
      const [created] = await db
        .insert(users)
        .values({
          email: input.email,
          fullName: input.fullName ?? input.email.split('@')[0]!,
          // Deliberately unusable: sign-in is only possible after a reset.
          passwordHash: 'scrypt$1$invited$invited',
        })
        .returning();
      userId = created!.id;
    }

    const [duplicate] = await db
      .select({ id: businessMembers.id })
      .from(businessMembers)
      .where(and(eq(businessMembers.businessId, tenant.business.id), eq(businessMembers.userId, userId)))
      .limit(1);
    if (duplicate) throw badRequest('That person is already a member of this business.');

    const [member] = await db
      .insert(businessMembers)
      .values({
        businessId: tenant.business.id,
        userId,
        role: input.role,
        invitedByUserId: auth.user.id,
        invitedAt: new Date(),
      })
      .returning();

    await writeAudit(db, {
      businessId: tenant.business.id,
      actorUserId: auth.user.id,
      actorName: auth.user.fullName,
      action: 'member.invited',
      entityType: 'business_member',
      entityId: member!.id,
      summary: `${auth.user.fullName} invited ${input.email} as ${input.role}.`,
    });

    res.status(201).json({ id: member!.id, userId, role: member!.role, email: input.email });
  }),
);

businessRouter.patch(
  '/members/:memberId',
  requireAuth,
  requireBusiness,
  requirePermission('members:manage'),
  handler(async (req, res) => {
    const auth = getAuth(req);
    const tenant = getTenant(req);
    const input = parse(updateMemberSchema, req.body);
    const db = await getDb();

    const [member] = await db
      .select()
      .from(businessMembers)
      .where(and(eq(businessMembers.id, param(req, 'memberId')), eq(businessMembers.businessId, tenant.business.id)))
      .limit(1);
    if (!member) throw notFound('That team member');
    if (member.role === 'owner') throw forbidden('The owner’s membership cannot be changed here.');
    if (input.role && ROLE_RANK[input.role] >= ROLE_RANK[tenant.role]) {
      throw forbidden('You cannot grant a role equal to or above your own.');
    }

    const [updated] = await db
      .update(businessMembers)
      .set({
        ...(input.role ? { role: input.role } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: new Date(),
      })
      .where(eq(businessMembers.id, member.id))
      .returning();

    await writeAudit(db, {
      businessId: tenant.business.id,
      actorUserId: auth.user.id,
      actorName: auth.user.fullName,
      action: 'member.updated',
      entityType: 'business_member',
      entityId: member.id,
      summary: `${auth.user.fullName} updated a team member.`,
      metadata: { role: input.role, active: input.active },
    });

    res.json({ id: updated!.id, role: updated!.role, active: updated!.active });
  }),
);

export { createSession };
