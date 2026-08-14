import { env } from '@nexa/config';
import { businessMembers, businesses, businessSettings, getDb, sessions, users } from '@nexa/database';
import { permissionsForRole, type Permission } from '@nexa/types';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden, unauthorized } from '../lib/errors.js';
import { hashToken } from '../lib/crypto.js';
import { getAuth, getTenant } from './context.js';

export const SESSION_COOKIE = 'nexa_session';
export const BUSINESS_HEADER = 'x-nexa-business';

/**
 * Resolves the session cookie into a user, if present. Never rejects — routes
 * declare their own requirement via `requireAuth`, so public endpoints can also
 * benefit from knowing who is calling.
 */
export const loadSession: RequestHandler = (req, _res, next) => {
  void (async () => {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (typeof raw !== 'string' || raw.length < 32) return next();

    const db = await getDb();
    const rows = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(eq(sessions.tokenHash, hashToken(raw)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return next();

    req.auth = { user: row.user, sessionId: row.session.id };

    // Sliding "last seen" — cheap enough at this cadence, and it powers the
    // active-sessions list in security settings.
    const staleBy = Date.now() - row.session.lastSeenAt.getTime();
    if (staleBy > 5 * 60 * 1000) {
      await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
    }
    next();
  })().catch(next);
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  next();
};

/**
 * Resolves the active business from the `x-nexa-business` header (falling back
 * to the user's last-used business) and loads the caller's membership.
 *
 * Membership is the tenancy gate: a business id the caller is not a member of
 * behaves exactly like one that does not exist.
 */
export const loadTenant: RequestHandler = (req, _res, next) => {
  void (async () => {
    if (!req.auth) return next();
    const db = await getDb();
    const requested = req.header(BUSINESS_HEADER) ?? req.auth.user.lastBusinessId ?? null;

    const rows = await db
      .select({ business: businesses, member: businessMembers, settings: businessSettings })
      .from(businessMembers)
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .leftJoin(businessSettings, eq(businessSettings.businessId, businesses.id))
      .where(
        requested
          ? and(
              eq(businessMembers.userId, req.auth.user.id),
              eq(businessMembers.businessId, requested),
              eq(businessMembers.active, true),
            )
          : and(eq(businessMembers.userId, req.auth.user.id), eq(businessMembers.active, true)),
      )
      .limit(1);

    const row = rows[0];
    if (!row || !row.settings) return next();

    req.tenant = {
      business: row.business,
      member: row.member,
      settings: row.settings,
      role: row.member.role,
      permissions: [...permissionsForRole(row.member.role)],
    };
    next();
  })().catch(next);
};

export const requireBusiness: RequestHandler = (req, _res, next) => {
  getAuth(req);
  if (!req.tenant) {
    return next(forbidden('Finish setting up your business to continue.'));
  }
  next();
};

/** Route-level authorization. Always server-side; the client only hides UI. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const tenant = getTenant(req);
      const missing = permissions.filter((permission) => !tenant.permissions.includes(permission));
      if (missing.length > 0) {
        return next(forbidden(`Your role (${tenant.role}) cannot perform this action.`));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function sessionCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: maxAgeMs,
  };
}
