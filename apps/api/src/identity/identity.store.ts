export type UserStatus = 'active' | 'suspended' | 'deactivated' | 'invited';

export interface IdentityUser {
  id: string;
  email: string;
  /** Null until an invited user accepts their invitation and sets a password. */
  passwordHash: string | null;
  mustChangePassword: boolean;
  status: UserStatus;
}

export interface PasswordUpdate {
  passwordHash: string;
  mustChangePassword: false;
  passwordChangedAt: Date;
}

export interface IdentityStore {
  findUserByEmail(email: string): Promise<IdentityUser | null>;
  findUserById(userId: string): Promise<IdentityUser | null>;
  updatePassword(userId: string, update: PasswordUpdate): Promise<void>;
}
