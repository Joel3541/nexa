import type { Business, BusinessMember, BusinessSettingsRow, User } from '@nexa/database';
import type { MemberRole, Permission } from '@nexa/types';
import type { Request } from 'express';
import { forbidden, unauthorized } from '../lib/errors.js';

export interface AuthContext {
  user: User;
  sessionId: string;
}

export interface TenantContext {
  business: Business;
  settings: BusinessSettingsRow;
  member: BusinessMember;
  role: MemberRole;
  permissions: Permission[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
      auth?: AuthContext;
      tenant?: TenantContext;
    }
  }
}

/** Accessors that fail loudly rather than letting a route read `undefined`. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function getTenant(req: Request): TenantContext {
  if (!req.tenant) throw forbidden('Select a business first.');
  return req.tenant;
}

export function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]!.trim().slice(0, 64);
  return req.ip?.slice(0, 64) ?? null;
}

export function userAgent(req: Request): string | null {
  const value = req.headers['user-agent'];
  return typeof value === 'string' ? value.slice(0, 500) : null;
}

export {};
