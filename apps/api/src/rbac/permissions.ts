import { ForbiddenError } from '../common/errors.js';

export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'manage'] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** One action on one area of an organisation, granted to a role (role_permissions). */
export interface Permission {
  area: string;
  action: PermissionAction;
}

export const ORGANISATION_SETTINGS_AREA = 'organisation-settings';

export function isPermissionAction(value: string): value is PermissionAction {
  return (PERMISSION_ACTIONS as readonly string[]).includes(value);
}

export function hasPermission(granted: readonly Permission[], area: string, action: PermissionAction): boolean {
  return granted.some((permission) => permission.area === area && permission.action === action);
}

export class PermissionDeniedError extends ForbiddenError {
  constructor(message: string) {
    super('PERMISSION_DENIED', message);
  }
}
