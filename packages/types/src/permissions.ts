import { PERMISSIONS, type MemberRole, type Permission } from './enums.js';

/**
 * Role → permission matrix.
 *
 * Authorization is always evaluated server-side against this table. The client
 * receives the resolved permission list purely so it can hide affordances the
 * user cannot use; it is never the enforcement point.
 */
const READ_ONLY: Permission[] = [
  'business:read',
  'members:read',
  'customers:read',
  'products:read',
  'inventory:read',
  'orders:read',
  'invoices:read',
  'expenses:read',
  'tasks:read',
  'appointments:read',
  'analytics:read',
  'campaigns:read',
];

const STAFF: Permission[] = [
  ...READ_ONLY,
  'customers:write',
  'products:read',
  'inventory:write',
  'orders:write',
  'invoices:write',
  'tasks:write',
  'appointments:write',
  'ai:use',
];

const MANAGER: Permission[] = [
  ...STAFF,
  'products:write',
  'invoices:send',
  'expenses:write',
  'campaigns:send',
  'customers:delete',
];

const ADMIN: Permission[] = [
  ...MANAGER,
  'business:update',
  'members:manage',
  'products:delete',
  'orders:refund',
  'ai:approve_actions',
  'audit:read',
  'settings:manage',
];

export const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: dedupe(ADMIN),
  manager: dedupe(MANAGER),
  staff: dedupe(STAFF),
  viewer: dedupe(READ_ONLY),
};

function dedupe(list: Permission[]): Permission[] {
  return [...new Set(list)];
}

export function permissionsForRole(role: MemberRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.viewer;
}

export function roleHasPermission(role: MemberRole, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

/** Ranking used to prevent privilege escalation (a manager cannot appoint an admin). */
export const ROLE_RANK: Record<MemberRole, number> = {
  owner: 100,
  admin: 80,
  manager: 60,
  staff: 40,
  viewer: 20,
};
