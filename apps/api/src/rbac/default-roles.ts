import { ORGANISATION_SETTINGS_AREA, type Permission } from './permissions.js';

export const ORGANISATION_ADMINISTRATOR_ROLE_NAME = 'Organisation Administrator';
export const DONATION_MANAGER_ROLE_NAME = 'Donation Manager';
export const MEMBER_ROLE_NAME = 'Member';

/** Created fresh for every new organisation; nothing is copied from another organisation. */
export const DEFAULT_ORGANISATION_ROLE_NAMES = [
  ORGANISATION_ADMINISTRATOR_ROLE_NAME,
  DONATION_MANAGER_ROLE_NAME,
  MEMBER_ROLE_NAME,
] as const;

export type DefaultOrganisationRoleName = (typeof DEFAULT_ORGANISATION_ROLE_NAMES)[number];

/**
 * The permissions each default role starts with. Areas are added here as the stories that own them
 * land; the role-management story lets an organisation change them afterwards.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<DefaultOrganisationRoleName, readonly Permission[]> = {
  [ORGANISATION_ADMINISTRATOR_ROLE_NAME]: [
    { area: ORGANISATION_SETTINGS_AREA, action: 'view' },
    { area: ORGANISATION_SETTINGS_AREA, action: 'edit' },
  ],
  [DONATION_MANAGER_ROLE_NAME]: [],
  [MEMBER_ROLE_NAME]: [],
};
