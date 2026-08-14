import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@nexa/types';
import { getDb, users } from '@nexa/database';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { handler, parse } from '../lib/http.js';
import { SESSION_COOKIE, requireAuth, sessionCookieOptions } from '../middleware/auth.js';
import { clientIp, getAuth, userAgent } from '../middleware/context.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  authenticate,
  buildSessionContext,
  changePassword,
  registerUser,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  sessionMaxAgeMs,
  toSessionUser,
  verifyEmail,
} from '../services/auth.service.js';

export const authRouter: Router = Router();

const meta = (req: Parameters<typeof clientIp>[0]) => ({ ip: clientIp(req), userAgent: userAgent(req) });

// Auth endpoints are rate limited per IP *and* per submitted email, so one
// attacker cannot lock out an account by spraying from many addresses, and a
// single address cannot brute-force many accounts.
const authLimiter = rateLimit('auth', {
  windowMs: 15 * 60 * 1000,
  max: 20,
  key: (req) => `${clientIp(req) ?? 'unknown'}:${String((req.body as { email?: string } | undefined)?.email ?? '')}`,
  message: 'Too many attempts. Please wait a few minutes before trying again.',
});

authRouter.post(
  '/register',
  authLimiter,
  handler(async (req, res) => {
    const input = parse(registerSchema, req.body);
    const { user, token } = await registerUser(input, meta(req));
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(sessionMaxAgeMs));
    res.status(201).json(await buildSessionContext(user, null));
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  handler(async (req, res) => {
    const input = parse(loginSchema, req.body);
    const { user, token } = await authenticate(input, meta(req));
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(sessionMaxAgeMs));
    res.json(await buildSessionContext(user, user.lastBusinessId));
  }),
);

authRouter.post(
  '/logout',
  handler(async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') await revokeSession(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/session',
  handler(async (req, res) => {
    if (!req.auth) {
      res.json({ user: null, business: null, businesses: [], role: null, permissions: [], settings: null, plan: 'free' });
      return;
    }
    res.json(await buildSessionContext(req.auth.user, req.tenant?.business.id ?? null));
  }),
);

authRouter.post(
  '/forgot-password',
  rateLimit('forgot-password', { windowMs: 60 * 60 * 1000, max: 5 }),
  handler(async (req, res) => {
    const input = parse(forgotPasswordSchema, req.body);
    await requestPasswordReset(input.email);
    // Always the same response, whether or not the address exists.
    res.json({ ok: true, message: 'If that email is registered, a reset link is on its way.' });
  }),
);

authRouter.post(
  '/reset-password',
  rateLimit('reset-password', { windowMs: 60 * 60 * 1000, max: 10 }),
  handler(async (req, res) => {
    const input = parse(resetPasswordSchema, req.body);
    await resetPassword(input.token, input.password);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/verify-email',
  handler(async (req, res) => {
    const input = parse(z.object({ token: z.string().min(20).max(200) }), req.body);
    await verifyEmail(input.token);
    res.json({ ok: true });
  }),
);

authRouter.patch(
  '/profile',
  requireAuth,
  handler(async (req, res) => {
    const auth = getAuth(req);
    const input = parse(updateProfileSchema, req.body);
    const db = await getDb();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['fullName', 'phone', 'avatarUrl', 'timezone'] as const) {
      if (input[key] !== undefined) patch[key] = input[key] ?? null;
    }
    const [updated] = await db.update(users).set(patch).where(eq(users.id, auth.user.id)).returning();
    res.json(toSessionUser(updated!));
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  rateLimit('change-password', { windowMs: 60 * 60 * 1000, max: 10 }),
  handler(async (req, res) => {
    const auth = getAuth(req);
    const input = parse(changePasswordSchema, req.body);
    await changePassword(auth.user, input.currentPassword, input.newPassword);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true, message: 'Password changed. Please sign in again.' });
  }),
);
