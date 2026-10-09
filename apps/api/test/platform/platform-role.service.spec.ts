import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/common/errors.js';
import { PlatformRoleAssignmentRefusedError } from '../../src/platform/errors.js';
import { PlatformRoleService } from '../../src/platform/platform-role.service.js';
import { SUPER_ADMIN_ROLE_KEY } from '../../src/platform/platform-roles.js';
import { setupPlatform } from '../../src/platform/setup-platform.js';
import { FakeHasher, InMemoryDatabase, RecordingLogger } from '../support/in-memory-database.js';

async function installedPlatform() {
  const db = new InMemoryDatabase();
  await setupPlatform({ store: db, hasher: new FakeHasher(), logger: new RecordingLogger() }, () => ({
    email: 'root@example.org',
    password: 'initial-Secret-123',
  }));
  const [superAdminId] = db.holderIdsOf(SUPER_ADMIN_ROLE_KEY);
  const superAdmin = { userId: superAdminId, platformRoles: [SUPER_ADMIN_ROLE_KEY], impersonating: false };
  return { db, superAdmin, service: new PlatformRoleService(db) };
}

describe('PlatformRoleService', () => {
  it('refuses an organisation administrator who tries to grant the super administrator role', async () => {
    const { db, service } = await installedPlatform();
    db.addOrganisationMember('org-a', 'admin@org-a.example');
    const [adminUserId] = [...db.users.values()].filter((u) => u.email === 'admin@org-a.example').map((u) => u.id);
    const orgAdmin = { userId: adminUserId, platformRoles: [], impersonating: false };

    await expect(service.grant(orgAdmin, adminUserId, SUPER_ADMIN_ROLE_KEY)).rejects.toBeInstanceOf(
      PlatformRoleAssignmentRefusedError,
    );
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toHaveLength(1);
  });

  it('refuses a super administrator who is impersonating', async () => {
    const { db, superAdmin, service } = await installedPlatform();
    const targetId = db.addUser('someone@example.org');

    await expect(service.grant({ ...superAdmin, impersonating: true }, targetId, SUPER_ADMIN_ROLE_KEY)).rejects.toBeInstanceOf(
      PlatformRoleAssignmentRefusedError,
    );
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toEqual([superAdmin.userId]);
  });

  it('lets a super administrator grant the role', async () => {
    const { db, superAdmin, service } = await installedPlatform();
    const targetId = db.addUser('second@example.org');

    await service.grant(superAdmin, targetId, SUPER_ADMIN_ROLE_KEY);
    await service.grant(superAdmin, targetId, SUPER_ADMIN_ROLE_KEY);

    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toEqual([superAdmin.userId, targetId]);
    expect(db.platformRoleGrants.at(-1)?.grantedByUserId).toBe(superAdmin.userId);
  });

  it('refuses to remove the last super administrator', async () => {
    const { db, superAdmin, service } = await installedPlatform();

    await expect(service.revoke(superAdmin, superAdmin.userId, SUPER_ADMIN_ROLE_KEY)).rejects.toBeInstanceOf(ConflictError);
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toEqual([superAdmin.userId]);
  });

  it('removes a super administrator when another remains', async () => {
    const { db, superAdmin, service } = await installedPlatform();
    const secondId = db.addUser('second@example.org');
    await service.grant(superAdmin, secondId, SUPER_ADMIN_ROLE_KEY);

    await service.revoke(superAdmin, secondId, SUPER_ADMIN_ROLE_KEY);

    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toEqual([superAdmin.userId]);
  });
});
