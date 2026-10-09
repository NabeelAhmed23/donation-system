import type { Prisma } from '@cms/db';
import { isUuid } from '../common/uuid.js';
import type { RoleAssignmentStore } from './role-assignment.store.js';

/** `tx` must be the request's tenant-scoped transaction (app.org_id set), so RLS also applies. */
export class PrismaRoleAssignmentStore implements RoleAssignmentStore {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async isPlatformRole(roleRef: string): Promise<boolean> {
    const where = isUuid(roleRef) ? { OR: [{ id: roleRef }, { key: roleRef }] } : { key: roleRef };
    return (await this.tx.platformRole.count({ where })) > 0;
  }

  async findMembership(orgId: string, membershipId: string): Promise<{ id: string } | null> {
    if (!isUuid(membershipId)) return null;
    return this.tx.membership.findFirst({ where: { orgId, id: membershipId }, select: { id: true } });
  }

  async findRole(orgId: string, roleId: string): Promise<{ id: string } | null> {
    if (!isUuid(roleId)) return null;
    return this.tx.role.findFirst({ where: { orgId, id: roleId }, select: { id: true } });
  }

  async hasRole(orgId: string, membershipId: string, roleId: string): Promise<boolean> {
    return (await this.tx.membershipRole.count({ where: { orgId, membershipId, roleId } })) > 0;
  }

  async assignRole(orgId: string, membershipId: string, roleId: string): Promise<void> {
    await this.tx.membershipRole.create({ data: { orgId, membershipId, roleId } });
  }
}
