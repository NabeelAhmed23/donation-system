import type { UserStatus } from '../identity/identity.store.js';

export interface PlatformRoleRecord {
  id: string;
  key: string;
}

export interface NewPlatformUser {
  email: string;
  passwordHash: string;
  mustChangePassword: boolean;
}

export interface CredentialReset {
  passwordHash: string;
  mustChangePassword: true;
  status: Extract<UserStatus, 'active'>;
}

export interface PlatformTx {
  findPlatformRoleByKey(key: string): Promise<PlatformRoleRecord | null>;
  createPlatformRole(role: { key: string; name: string }): Promise<PlatformRoleRecord>;
  countRoleHolders(roleId: string): Promise<number>;
  findUserIdByEmail(email: string): Promise<string | null>;
  userExists(userId: string): Promise<boolean>;
  createUser(user: NewPlatformUser): Promise<{ id: string }>;
  hasPlatformRole(userId: string, roleId: string): Promise<boolean>;
  grantPlatformRole(grant: { userId: string; roleId: string; grantedByUserId: string | null }): Promise<void>;
  revokePlatformRole(userId: string, roleId: string): Promise<void>;
  findRoleHolderIdByEmail(roleId: string, email: string): Promise<string | null>;
  resetCredentials(userId: string, reset: CredentialReset): Promise<void>;
}

export interface PlatformStore {
  /** Runs `work` in one transaction, serialised against every other platform-role change. */
  runExclusive<T>(work: (tx: PlatformTx) => Promise<T>): Promise<T>;
}
