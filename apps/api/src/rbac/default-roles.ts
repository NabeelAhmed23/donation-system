export const ORGANISATION_ADMINISTRATOR_ROLE_NAME = 'Organisation Administrator';
export const DONATION_MANAGER_ROLE_NAME = 'Donation Manager';
export const MEMBER_ROLE_NAME = 'Member';

/** Created fresh for every new organisation; nothing is copied from another organisation. */
export const DEFAULT_ORGANISATION_ROLE_NAMES = [
  ORGANISATION_ADMINISTRATOR_ROLE_NAME,
  DONATION_MANAGER_ROLE_NAME,
  MEMBER_ROLE_NAME,
] as const;
