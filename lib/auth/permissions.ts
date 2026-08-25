/**
 * Role-based permission checks
 * Fail-closed: If permission cannot be verified, deny access
 */

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer'

export const permissions: Record<UserRole, Set<string>> = {
  owner: new Set([
    'read:organization',
    'write:organization',
    'delete:organization',
    'manage:members',
    'manage:agents',
    'manage:settings',
    'create:approval',
    'approve:decision',
    'read:all_data',
  ]),
  admin: new Set([
    'read:organization',
    'write:organization',
    'manage:agents',
    'manage:settings',
    'create:approval',
    'approve:decision',
    'read:all_data',
  ]),
  member: new Set([
    'read:organization',
    'write:organization',
    'read:all_data',
    'create:task',
  ]),
  viewer: new Set([
    'read:organization',
    'read:all_data',
  ]),
}

export function hasPermission(
  role: UserRole | undefined,
  permission: string
): boolean {
  if (!role) return false
  
  const rolePerms = permissions[role]
  if (!rolePerms) return false
  
  return rolePerms.has(permission)
}

export function requirePermission(
  role: UserRole | undefined,
  permission: string
): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Insufficient permissions: ${permission} required`)
  }
}
