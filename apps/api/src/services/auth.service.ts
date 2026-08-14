import { env } from '@nexa/config';
import {
  businessMembers,
  businesses,
  businessSettings,
  getDb,
  sessions,
  subscriptions,
  users,
  verificationTokens,
  type User,
} from '@nexa/database';
import { getChannelAdapter } from '@nexa/integrations';
import { permissionsForRole, type SessionContext, type SessionUser } from '@nexa/types';
import { and, eq, isNull } from 'drizzle-orm';
import { conflict, forbidden, unauthorized } from '../lib/errors.js';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { trackUsage, writeAudit } from '../db/records.js';

const SESSION_TTL_MS = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export async function registerUser(
  input: { fullName: string; email: string; password: string },
  meta: RequestMeta,
): Promise<{ user: User; token: string }> {
  const db = await getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existing.length > 0) {
    throw conflict('An account with that email already exists.', { email: 'Email already registered' });
  }

  const passwordHash = await hashPassword(input.password);
  const inserted = await db
    .insert(users)
    .values({ email: input.email, fullName: input.fullName, passwordHash })
    .returning();
  const user = inserted[0]!;

  await issueEmailVerification(user);
  await writeAudit(db, {
    businessId: null,
    actorUserId: user.id,
    actorName: user.fullName,
    action: 'user.registered',
    entityType: 'user',
    entityId: user.id,
    summary: `${user.fullName} created an account.`,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });
  await trackUsage(db, { businessId: null, userId: user.id, name: 'user_registered' });

  const token = await createSession(user.id, meta);
  return { user, token };
}

export async function authenticate(
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<{ user: User; token: string }> {
  const db = await getDb();
  const found = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  const user = found[0];

  // Uniform failure message and comparable work regardless of whether the
  // account exists — no user enumeration through timing or wording.
  if (!user) {
    await hashPassword(input.password);
    throw unauthorized('That email or password is incorrect.');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw forbidden(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    await db
      .update(users)
      .set({
        failedLoginCount: failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
      })
      .where(eq(users.id, user.id));
    await writeAudit(db, {
      businessId: null,
      actorUserId: user.id,
      actorName: user.fullName,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user.id,
      summary: `Failed sign-in attempt (${failed}).`,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    throw unauthorized('That email or password is incorrect.');
  }

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  await writeAudit(db, {
    businessId: user.lastBusinessId,
    actorUserId: user.id,
    actorName: user.fullName,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    summary: `${user.fullName} signed in.`,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });
  await trackUsage(db, { businessId: user.lastBusinessId, userId: user.id, name: 'user_signed_in' });

  const token = await createSession(user.id, meta);
  return { user, token };
}

export async function createSession(userId: string, meta: RequestMeta): Promise<string> {
  const db = await getDb();
  const { token, hash } = generateToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });
  return token;
}

export const sessionMaxAgeMs = SESSION_TTL_MS;

export async function revokeSession(token: string): Promise<void> {
  const db = await getDb();
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function revokeAllSessions(userId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

async function issueEmailVerification(user: User): Promise<void> {
  const db = await getDb();
  const { token, hash } = generateToken();
  await db.insert(verificationTokens).values({
    userId: user.id,
    purpose: 'email_verification',
    tokenHash: hash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const link = `${env.WEB_ORIGIN}/verify-email?token=${token}`;
  await getChannelAdapter('email').send({
    channel: 'email',
    to: user.email,
    subject: 'Verify your NEXA account',
    body: `Hi ${user.fullName},\n\nConfirm your email to finish setting up NEXA:\n${link}\n\nThe link expires in 24 hours.`,
  });
}

export async function verifyEmail(token: string): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.tokenHash, hashToken(token)), eq(verificationTokens.purpose, 'email_verification')))
    .limit(1);
  const record = rows[0];
  if (!record || record.consumedAt || record.expiresAt.getTime() < Date.now()) {
    throw unauthorized('That verification link is invalid or has expired.');
  }
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, record.userId));
  await db.update(verificationTokens).set({ consumedAt: new Date() }).where(eq(verificationTokens.id, record.id));
}

/**
 * Always resolves successfully, whether or not the address is registered —
 * the response must not reveal which emails have accounts.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user) {
    logger.info('password reset requested for unknown address', { email: '[redacted]' });
    return;
  }
  const { token, hash } = generateToken();
  await db.insert(verificationTokens).values({
    userId: user.id,
    purpose: 'password_reset',
    tokenHash: hash,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  const link = `${env.WEB_ORIGIN}/reset-password?token=${token}`;
  await getChannelAdapter('email').send({
    channel: 'email',
    to: user.email,
    subject: 'Reset your NEXA password',
    body: `Hi ${user.fullName},\n\nReset your password here:\n${link}\n\nThe link expires in one hour. If you did not request this, ignore this email.`,
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.tokenHash, hashToken(token)), eq(verificationTokens.purpose, 'password_reset')))
    .limit(1);
  const record = rows[0];
  if (!record || record.consumedAt || record.expiresAt.getTime() < Date.now()) {
    throw unauthorized('That reset link is invalid or has expired.');
  }
  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, record.userId));
  await db.update(verificationTokens).set({ consumedAt: new Date() }).where(eq(verificationTokens.id, record.id));
  // A password change invalidates every existing session.
  await revokeAllSessions(record.userId);
  await writeAudit(db, {
    businessId: null,
    actorUserId: record.userId,
    actorName: null,
    action: 'auth.password_reset',
    entityType: 'user',
    entityId: record.userId,
    summary: 'Password reset completed; all sessions revoked.',
  });
}

export async function changePassword(user: User, currentPassword: string, newPassword: string): Promise<void> {
  const db = await getDb();
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw unauthorized('Your current password is incorrect.');
  }
  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, user.id));
  await revokeAllSessions(user.id);
  await writeAudit(db, {
    businessId: user.lastBusinessId,
    actorUserId: user.id,
    actorName: user.fullName,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: user.id,
    summary: 'Password changed; all sessions revoked.',
  });
}

export function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    emailVerified: user.emailVerifiedAt !== null,
    timezone: user.timezone,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Builds the payload the web client bootstraps from on every load. */
export async function buildSessionContext(user: User, activeBusinessId: string | null): Promise<SessionContext> {
  const db = await getDb();
  const memberships = await db
    .select({ business: businesses, member: businessMembers })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .where(and(eq(businessMembers.userId, user.id), eq(businessMembers.active, true)));

  const list = memberships.map(({ business, member }) => ({
    id: business.id,
    name: business.name,
    slug: business.slug,
    role: member.role,
    logoUrl: business.logoUrl,
  }));

  const active =
    memberships.find((m) => m.business.id === activeBusinessId) ??
    memberships.find((m) => m.business.id === user.lastBusinessId) ??
    memberships[0];

  if (!active) {
    return {
      user: toSessionUser(user),
      business: null,
      businesses: list,
      role: null,
      permissions: [],
      settings: null,
      plan: 'free',
    };
  }

  const [settingsRow] = await db
    .select()
    .from(businessSettings)
    .where(eq(businessSettings.businessId, active.business.id))
    .limit(1);
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.businessId, active.business.id))
    .limit(1);

  const { toBusinessSummary, toBusinessSettings } = await import('./business.service.js');

  return {
    user: toSessionUser(user),
    business: toBusinessSummary(active.business),
    businesses: list,
    role: active.member.role,
    permissions: [...permissionsForRole(active.member.role)],
    settings: settingsRow ? toBusinessSettings(settingsRow) : null,
    plan: subscription?.plan ?? 'free',
  };
}
