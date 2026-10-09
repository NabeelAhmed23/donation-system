import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../src/common/errors.js';
import { PlatformRoleAssignmentRefusedError } from '../../src/platform/errors.js';
import { SUPER_ADMIN_ROLE_KEY } from '../../src/platform/platform-roles.js';
import { setupPlatform } from '../../src/platform/setup-platform.js';
import { RoleAssignmentService } from '../../src/rbac/role-assignment.service.js';
import { FakeHasher, InMemoryDatabase, RecordingLogger } from '../support/in-memory-database.js';

async function organisationWithAdmin() {
  const db = new InMemoryDatabase();
  await setupPlatform({ store: db, hasher: new FakeHasher(), logger: new RecordingLogger() }, () => ({
    email: 'root@example.org',
    password: 'initial-Secret-123',
  }));
  const adminMembershipId = db.addOrganisationMember('org-a', 'admin@org-a.example');
  const memberMembershipId = db.addOrganisationMember('org-a', 'member@org-a.example');
  const adminUserId = db.memberships.find((m) => m.id === adminMembershipId)!.userId;
  return { db, memberMembershipId, orgAdmin: { userId: adminUserId, orgId: 'org-a' }, service: new RoleAssignmentService(db) };
}

describe('RoleAssignmentService', () => {
  it('refuses to assign the super administrator role by id', async () => {
    const { db, memberMembershipId, orgAdmin, service } = await organisationWithAdmin();
    const superAdminRoleId = db.platformRoles.find((r) => r.key === SUPER_ADMIN_ROLE_KEY)!.id;

    await expect(
      service.assignRole(orgAdmin, { membershipId: memberMembershipId, roleId: superAdminRoleId }),
    ).rejects.toBeInstanceOf(PlatformRoleAssignmentRefusedError);
    expect(db.membershipRoles).toEqual([]);
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toHaveLength(1);
  });

  it('refuses to assign the super administrator role by key', async () => {
    const { db, memberMembershipId, orgAdmin, service } = await organisationWithAdmin();

    await expect(
      service.assignRole(orgAdmin, { membershipId: memberMembershipId, roleId: SUPER_ADMIN_ROLE_KEY }),
    ).rejects.toBeInstanceOf(PlatformRoleAssignmentRefusedError);
    expect(db.membershipRoles).toEqual([]);
  });

  it('assigns one of the organisation's own roles', async () => {
    const { db, memberMembershipId, orgAdmin, service } = await organisationWithAdmin();
    const roleId = db.addOrganisationRole('org-a', 'Donation Manager');

    await service.assignRole(orgAdmin, { membershipId: memberMembershipId, roleId });

    expect(db.membershipRoles).toEqual([{ orgId: 'org-a', membershipId: memberMembershipId, roleId }]);
  });

  it('does not find a role belonging to another organisation', async () => {
    const { db, memberMembershipId, orgAdmin, service } = await organisationWithAdmin();
    const foreignRoleId = db.addOrganisationRole('org-b', 'Organisation Administrator');

    await expect(
      service.assignRole(orgAdmin, { membershipId: memberMembershipId, roleId: foreignRoleId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(db.membershipRoles).toEqual([]);
  });
});
