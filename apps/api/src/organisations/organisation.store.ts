import type { UserStatus } from '../identity/identity.store.js';
import type { Permission } from '../rbac/permissions.js';
import type { NewOrganisationSettings } from './new-organisation.js';

export interface ExistingUser {
  id: string;
  status: UserStatus;
  holdsPlatformRole: boolean;
}

/** Writes for one new organisation. Every row written belongs to that organisation. */
export interface NewOrganisationTx {
  /** False when another organisation already has this name (ignoring case). */
  insertOrganisation(settings: NewOrganisationSettings): Promise<boolean>;
  findUserByEmail(email: string): Promise<ExistingUser | null>;
  createInvitedUser(email: string): Promise<{ id: string; status: UserStatus }>;
  createRoles(names: readonly string[]): Promise<{ id: string; name: string }[]>;
  grantPermissions(roleId: string, permissions: readonly Permission[]): Promise<void>;
  /** Null when the user already belongs to an organisation: a user belongs to exactly one. */
  insertMembership(userId: string): Promise<string | null>;
  assignRole(membershipId: string, roleId: string): Promise<void>;
}

export interface OrganisationStore {
  /** Platform role keys of an active user; empty for anyone else. */
  platformRoleKeysOf(userId: string): Promise<string[]>;
  /**
   * Runs `work` in one transaction in the new organisation's tenant context, serialised against other
   * organisation creations. Nothing is kept if it throws.
   */
  runInNewOrganisation<T>(orgId: string, work: (tx: NewOrganisationTx) => Promise<T>): Promise<T>;
}
