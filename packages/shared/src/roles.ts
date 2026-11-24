/**
 * Role-based access control (ADR-0006). Roles are coarse bundles of permissions;
 * route handlers check permissions, never role names, so custom roles (SP-016)
 * can be introduced without touching handlers.
 */
export const ROLES = ['owner', 'admin', 'manager', 'operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'topology:read',
  'topology:write',
  'catalog:read',
  'catalog:write',
  'inventory:read',
  'inventory:receive',
  'inventory:move',
  'inventory:adjust',
  'inventory:verify',
  'allocation:read',
  'allocation:write',
  'audit:read',
  'users:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: readonly Permission[] = [
  'topology:read',
  'catalog:read',
  'inventory:read',
  'allocation:read',
];

const OPERATOR: readonly Permission[] = [...READ_ONLY, 'inventory:receive', 'inventory:move'];

const MANAGER: readonly Permission[] = [
  ...OPERATOR,
  'inventory:adjust',
  'allocation:write',
  'catalog:write',
  'audit:read',
];

const ADMIN: readonly Permission[] = [...MANAGER, 'topology:write', 'inventory:verify'];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  owner: [...ADMIN, 'users:manage'],
  admin: [...ADMIN, 'users:manage'],
  manager: MANAGER,
  operator: OPERATOR,
  viewer: READ_ONLY,
});

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
