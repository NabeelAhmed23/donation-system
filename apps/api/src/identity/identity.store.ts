export type UserStatus = 'active' | 'suspended' | 'deactivated';

export interface IdentityUser {
  id: string;
  email: string;
  passwordHash: string;
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
