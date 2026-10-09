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
  const orgAdmin = { userId: adminUserId, orgId: 'org-a' };
  return { db, orgAdmin, adminMembershipId, memberMembershipId, service: new RoleAssignmentService(db) };
}

describe('RoleAssignmentService', () => {
  it('refuses an organisation administrator who assigns the super administrator role by key', async () => {
    const { db, orgAdmin, memberMembershipId, service } = await organisationWithAdmin();

    await expect(
      service.assignRole(orgAdmin, { membershipId: memberMembershipId, roleId: SUPER_ADMIN_ROLE_KEY }),
    ).rejects.toBeInstanceOf(PlatformRoleAssignmentRefusedError);
    expect(db.membershipRoles).toEqual([]);
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toHaveLength(1);
  });

  it('refuses an organisation administrator who assigns the super administrator role by id', async () => {
    const { db, orgAdmin, memberMembershipId, service } = await organisationWithAdmin();
    const [superAdminRole] = db.platformRoles;

    await expect(
      service.assignRole(orgAdmin, { membershipId: memberMembershipId, roleId: superAdminRole.id }),
    ).rejects.toMatchObject({ code: 'PLATFORM_ROLE_ASSIGNMENT_REFUSED' });
    expect(db.membershipRoles).toEqual([]);
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toHaveLength(1);
  });

  it('refuses an organisation administrator who tries to promote themselves', async () => {
    const { db, orgAdmin, adminMembershipId, service } = await organisationWithAdmin();

    await expect(
      service.assignRole(orgAdmin, { membershipId: adminMembershipId, roleId: SUPER_ADMIN_ROLE_KEY }),
    ).rejects.toBeInstanceOf(PlatformRoleAssignmentRefusedError);
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).not.toContain(orgAdmin.userId);
  });

  it("assigns one of the organisation's own roles, once", async () => {
    const { db, orgAdmin, memberMembershipId, service } = await organisationWithAdmin();
    const roleId = db.addOrganisationRole('org-a', 'Donation Manager');

    await service.assignRole(orgAdmin, { membershipId: memberMembershipId, roleId });
    await service.assignRole(orgAdmin, { membershipId: memberMembershipId, roleId });

    expect(db.membershipRoles).toEqual([{ orgId: 'org-a', membershipId: memberMembershipId, roleId }]);
  });

  it("refuses another organisation's role as not found", async () => {
    const { db, orgAdmin, memberMembershipId, service } = await organisationWithAdmin();
    const foreignRoleId = db.addOrganisationRole('org-b', 'Donation Manager');

    await expect(
      service.assignRole(orgAdmin, { membershipId: memberMembershipId, roleId: foreignRoleId }),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
    expect(db.membershipRoles).toEqual([]);
  });

  it("refuses another organisation's member as not found", async () => {
    const { db, orgAdmin, service } = await organisationWithAdmin();
    const roleId = db.addOrganisationRole('org-a', 'Member');
    const foreignMembershipId = db.addOrganisationMember('org-b', 'member@org-b.example');

    await expect(
      service.assignRole(orgAdmin, { membershipId: foreignMembershipId, roleId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(db.membershipRoles).toEqual([]);
  });
});
