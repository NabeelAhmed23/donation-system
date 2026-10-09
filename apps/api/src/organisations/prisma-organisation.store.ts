import type { Prisma, PrismaClient } from '@cms/db';
import { isUuid } from '../common/uuid.js';
import type { UserStatus } from '../identity/identity.store.js';
import type { NewOrganisationSettings } from './new-organisation.js';
import type { ExistingUser, NewOrganisationTx, OrganisationStore } from './organisation.store.js';

/** `prisma` is the platform client: the transaction below sets its own tenant context. */
export class PrismaOrganisationStore implements OrganisationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async platformRoleKeysOf(userId: string): Promise<string[]> {
    if (!isUuid(userId)) return [];
    const grants = await this.prisma.userPlatformRole.findMany({
      where: { userId, user: { status: 'active' } },
      select: { platformRole: { select: { key: true } } },
    });
    return grants.map((grant) => grant.platformRole.key);
  }

  runInNewOrganisation<T>(orgId: string, work: (tx: NewOrganisationTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // Fixed advisory-lock key for organisation creation, so the initial administrator's email is
      // checked and claimed atomically; released when the transaction ends.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7100001)`;
      // Every write runs in the new organisation's tenant context: RLS refuses rows for any other organisation.
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
      return work(new PrismaNewOrganisationTx(tx, orgId));
    });
  }
}

class PrismaNewOrganisationTx implements NewOrganisationTx {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly orgId: string,
  ) {}

  async insertOrganisation(settings: NewOrganisationSettings): Promise<boolean> {
    // ON CONFLICT DO NOTHING: the case-insensitive name index detects a name taken by an organisation
    // this transaction cannot see, without an error that would abort the transaction.
    const created = await this.tx.organisation.createManyAndReturn({
      data: [{ id: this.orgId, ...settings }],
      skipDuplicates: true,
      select: { id: true },
    });
    return created.length === 1;
  }

  async findUserByEmail(email: string): Promise<ExistingUser | null> {
    const user = await this.tx.user.findUnique({
      where: { email },
      select: { id: true, status: true, _count: { select: { platformRoles: true } } },
    });
    return user ? { id: user.id, status: user.status, holdsPlatformRole: user._count.platformRoles > 0 } : null;
  }

  createInvitedUser(email: string): Promise<{ id: string; status: UserStatus }> {
    return this.tx.user.create({
      data: { email, status: 'invited', mustChangePassword: true },
      select: { id: true, status: true },
    });
  }

  createRoles(names: readonly string[]): Promise<{ id: string; name: string }[]> {
    return this.tx.role.createManyAndReturn({
      data: names.map((name) => ({ orgId: this.orgId, name })),
      select: { id: true, name: true },
    });
  }

  async insertMembership(userId: string): Promise<string | null> {
    // memberships.user_id is unique, so a user who belongs to another organisation conflicts here
    // even though RLS hides that membership from this transaction.
    const created = await this.tx.membership.createManyAndReturn({
      data: [{ orgId: this.orgId, userId }],
      skipDuplicates: true,
      select: { id: true },
    });
    return created[0]?.id ?? null;
  }

  async assignRole(membershipId: string, roleId: string): Promise<void> {
    await this.tx.membershipRole.create({ data: { orgId: this.orgId, membershipId, roleId } });
  }
}
