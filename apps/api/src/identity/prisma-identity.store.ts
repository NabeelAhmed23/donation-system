import type { PrismaClient } from '@cms/db';
import type { IdentityStore, IdentityUser, PasswordUpdate } from './identity.store.js';

const IDENTITY_USER_FIELDS = {
  id: true,
  email: true,
  passwordHash: true,
  mustChangePassword: true,
  status: true,
} as const;

export class PrismaIdentityStore implements IdentityStore {
  constructor(private readonly prisma: PrismaClient) {}

  findUserByEmail(email: string): Promise<IdentityUser | null> {
    return this.prisma.user.findUnique({ where: { email }, select: IDENTITY_USER_FIELDS });
  }

  findUserById(userId: string): Promise<IdentityUser | null> {
    return this.prisma.user.findUnique({ where: { id: userId }, select: IDENTITY_USER_FIELDS });
  }

  async updatePassword(userId: string, update: PasswordUpdate): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: update });
  }
}
