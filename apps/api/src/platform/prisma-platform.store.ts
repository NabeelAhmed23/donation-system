import type { Prisma, PrismaClient } from '@cms/db';
import type { CredentialReset, NewPlatformUser, PlatformRoleRecord, PlatformStore, PlatformTx } from './platform.store.js';

const ROLE_FIELDS = { id: true, key: true } as const;

export class PrismaPlatformStore implements PlatformStore {
  constructor(private readonly prisma: PrismaClient) {}

  runExclusive<T>(work: (tx: PlatformTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // Fixed advisory-lock key for platform-role changes; released when the transaction ends.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7100071)`;
      return work(new PrismaPlatformTx(tx));
    });
  }
}

class PrismaPlatformTx implements PlatformTx {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  findPlatformRoleByKey(key: string): Promise<PlatformRoleRecord | null> {
    return this.tx.platformRole.findUnique({ where: { key }, select: ROLE_FIELDS });
  }

  createPlatformRole(role: { key: string; name: string }): Promise<PlatformRoleRecord> {
    return this.tx.platformRole.create({ data: role, select: ROLE_FIELDS });
  }

  countRoleHolders(roleId: string): Promise<number> {
    return this.tx.userPlatformRole.count({ where: { platformRoleId: roleId } });
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const user = await this.tx.user.findUnique({ where: { email }, select: { id: true } });
    return user?.id ?? null;
  }

  async userExists(userId: string): Promise<boolean> {
    return (await this.tx.user.count({ where: { id: userId } })) > 0;
  }

  createUser(user: NewPlatformUser): Promise<{ id: string }> {
    return this.tx.user.create({ data: user, select: { id: true } });
  }

  async hasPlatformRole(userId: string, roleId: string): Promise<boolean> {
    return (await this.tx.userPlatformRole.count({ where: { userId, platformRoleId: roleId } })) > 0;
  }

  async grantPlatformRole(grant: { userId: string; roleId: string; grantedByUserId: string | null }): Promise<void> {
    await this.tx.userPlatformRole.create({
      data: { userId: grant.userId, platformRoleId: grant.roleId, grantedByUserId: grant.grantedByUserId },
    });
  }

  async revokePlatformRole(userId: string, roleId: string): Promise<void> {
    await this.tx.userPlatformRole.delete({ where: { userId_platformRoleId: { userId, platformRoleId: roleId } } });
  }

  async findRoleHolderIdByEmail(roleId: string, email: string): Promise<string | null> {
    const holder = await this.tx.userPlatformRole.findFirst({
      where: { platformRoleId: roleId, user: { email } },
      select: { userId: true },
    });
    return holder?.userId ?? null;
  }

  async resetCredentials(userId: string, reset: CredentialReset): Promise<void> {
    await this.tx.user.update({ where: { id: userId }, data: reset });
  }
}
