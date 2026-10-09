import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@cms/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganisationService } from '../../src/organisations/organisation.service.js';
import { OrganisationSettingsService } from '../../src/organisations/organisation-settings.service.js';
import { PrismaOrganisationSettingsStore } from '../../src/organisations/prisma-organisation-settings.store.js';
import { PrismaOrganisationStore } from '../../src/organisations/prisma-organisation.store.js';
import { SUPER_ADMIN_ROLE_KEY } from '../../src/platform/platform-roles.js';
import { PrismaPlatformStore } from '../../src/platform/prisma-platform.store.js';
import { setupPlatform } from '../../src/platform/setup-platform.js';
import { PrismaRoleAssignmentStore } from '../../src/rbac/prisma-role-assignment.store.js';
import { FakeHasher, RecordingLogger } from '../support/in-memory-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const credentials = { email: 'root@example.org', password: 'initial-Secret-123' };

function organisationInput(name: string, initialAdministratorEmail: string) {
  return { name, country: 'GB', defaultCurrency: 'GBP', timeZone: 'Europe/London', initialAdministratorEmail };
}

describe.skipIf(!databaseUrl)('platform roles on PostgreSQL', () => {
  let prisma: PrismaClient;
  let otherPrisma: PrismaClient;

  beforeAll(async () => {
    if (!databaseUrl) return;
    // Imported lazily so the unit suite runs without a built @cms/db when this suite is skipped.
    const { createPlatformPrismaClient } = await import('@cms/db');
    prisma = createPlatformPrismaClient(databaseUrl);
    otherPrisma = createPlatformPrismaClient(databaseUrl);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await otherPrisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "audit_log", "role_permissions", "user_platform_roles", "platform_roles", "membership_roles", "roles", "memberships", "organisations", "users"`;
  });

  function depsFor(client: PrismaClient) {
    return { store: new PrismaPlatformStore(client), hasher: new FakeHasher(), logger: new RecordingLogger() };
  }

  function inTenant<T>(orgId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
      return work(tx);
    });
  }

  async function signedInSuperAdmin() {
    await setupPlatform(depsFor(prisma), () => credentials);
    const holder = await prisma.userPlatformRole.findFirstOrThrow({ select: { userId: true } });
    return { userId: holder.userId, impersonating: false };
  }

  function organisationsOn(client: PrismaClient) {
    return new OrganisationService(new PrismaOrganisationStore(client));
  }

  function settingsOn(client: PrismaClient) {
    return new OrganisationSettingsService(new PrismaOrganisationSettingsStore(client));
  }

  async function organisationWithActiveAdmin(name = 'Hope Trust', adminEmail = 'admin@hopetrust.example') {
    const actor = await signedInSuperAdmin().catch(async () => {
      const holder = await prisma.userPlatformRole.findFirstOrThrow({ select: { userId: true } });
      return { userId: holder.userId, impersonating: false };
    });
    const created = await organisationsOn(prisma).create(actor, organisationInput(name, adminEmail));
    const adminId = created.initialAdministrator.userId;
    // Stands in for invitation acceptance, which a later story adds.
    await prisma.user.update({ where: { id: adminId }, data: { status: 'active', passwordHash: 'unused' } });
    return { orgId: created.id, admin: { userId: adminId, orgId: created.id, impersonating: false } };
  }

  it('creates one role and one account when two setups race on separate connections', async () => {
    const results = await Promise.all([
      setupPlatform(depsFor(prisma), () => credentials),
      setupPlatform(depsFor(otherPrisma), () => credentials),
    ]);

    expect(results.filter((r) => r.roleCreated)).toHaveLength(1);
    expect(results.filter((r) => r.accountCreated)).toHaveLength(1);
    expect(await prisma.platformRole.findMany({ select: { key: true } })).toEqual([{ key: SUPER_ADMIN_ROLE_KEY }]);
    expect(await prisma.userPlatformRole.count()).toBe(1);
    expect(await prisma.user.findMany({ select: { email: true, mustChangePassword: true } })).toEqual([
      { email: credentials.email, mustChangePassword: true },
    ]);
  });

  it('creates no second role or account when setup runs again', async () => {
    await setupPlatform(depsFor(prisma), () => credentials);

    const result = await setupPlatform(depsFor(prisma), () => {
      throw new Error('credentials should not be read');
    });

    expect(result).toEqual({ roleCreated: false, accountCreated: false });
    expect(await prisma.platformRole.count()).toBe(1);
    expect(await prisma.userPlatformRole.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });

  it('refuses an email that is not lower-case', async () => {
    await expect(
      prisma.user.create({ data: { email: 'Root@Example.org', passwordHash: 'unused' } }),
    ).rejects.toThrow();
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses platform-role writes from an organisation context', async () => {
    await setupPlatform(depsFor(prisma), () => credentials);
    const role = await prisma.platformRole.findUniqueOrThrow({ where: { key: SUPER_ADMIN_ROLE_KEY } });
    const user = await prisma.user.create({ data: { email: 'admin@org-a.example', passwordHash: 'unused' } });
    const orgId = randomUUID();

    await expect(
      inTenant(orgId, (tx) => tx.userPlatformRole.create({ data: { userId: user.id, platformRoleId: role.id } })),
    ).rejects.toThrow();
    await expect(inTenant(orgId, (tx) => tx.platformRole.create({ data: { key: 'rogue', name: 'Rogue' } }))).rejects.toThrow();
    await expect(inTenant(orgId, (tx) => tx.userPlatformRole.deleteMany())).rejects.toThrow();

    expect(await prisma.platformRole.count()).toBe(1);
    expect(await prisma.userPlatformRole.findMany({ select: { userId: true } })).not.toContainEqual({ userId: user.id });
    expect(await prisma.userPlatformRole.count()).toBe(1);
  });

  it('recognises the super administrator role by id and by key from an organisation transaction', async () => {
    await setupPlatform(depsFor(prisma), () => credentials);
    const role = await prisma.platformRole.findUniqueOrThrow({ where: { key: SUPER_ADMIN_ROLE_KEY } });
    const orgId = randomUUID();

    const answers = await inTenant(orgId, async (tx) => {
      await tx.organisation.create({
        data: { id: orgId, name: 'Org A', country: 'GB', defaultCurrency: 'GBP', timeZone: 'Europe/London' },
      });
      const orgRole = await tx.role.create({ data: { orgId, name: 'Member' }, select: { id: true } });
      const store = new PrismaRoleAssignmentStore(tx);
      return {
        byKey: await store.isPlatformRole(SUPER_ADMIN_ROLE_KEY),
        byId: await store.isPlatformRole(role.id),
        orgRole: await store.isPlatformRole(orgRole.id),
        unknown: await store.isPlatformRole('not-a-role'),
      };
    });

    expect(answers).toEqual({ byKey: true, byId: true, orgRole: false, unknown: false });
  });

  it('creates an organisation whose invited administrator holds the administrator role there only', async () => {
    const actor = await signedInSuperAdmin();

    const created = await organisationsOn(prisma).create(actor, organisationInput('Hope Trust', 'admin@hopetrust.example'));

    const stored = await inTenant(created.id, async (tx) => ({
      organisations: await tx.organisation.findMany({
        select: { id: true, name: true, country: true, defaultCurrency: true, timeZone: true },
      }),
      roles: await tx.role.findMany({ where: { orgId: created.id }, select: { name: true }, orderBy: { name: 'asc' } }),
      admin: await tx.user.findUniqueOrThrow({
        where: { email: 'admin@hopetrust.example' },
        select: {
          status: true,
          passwordHash: true,
          membership: { select: { orgId: true, roles: { select: { role: { select: { orgId: true, name: true } } } } } },
        },
      }),
    }));

    expect(stored.organisations).toEqual([
      { id: created.id, name: 'Hope Trust', country: 'GB', defaultCurrency: 'GBP', timeZone: 'Europe/London' },
    ]);
    expect(stored.roles).toEqual([{ name: 'Donation Manager' }, { name: 'Member' }, { name: 'Organisation Administrator' }]);
    expect(stored.admin).toEqual({
      status: 'invited',
      passwordHash: null,
      membership: { orgId: created.id, roles: [{ role: { orgId: created.id, name: 'Organisation Administrator' } }] },
    });
  });

  it('creates only one organisation when two super administrators use the same name at once', async () => {
    const actor = await signedInSuperAdmin();

    const results = await Promise.allSettled([
      organisationsOn(prisma).create(actor, organisationInput('Hope Trust', 'first@hopetrust.example')),
      organisationsOn(otherPrisma).create(actor, organisationInput('hope trust', 'second@hopetrust.example')),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected');
    expect(refused?.status === 'rejected' && refused.reason).toMatchObject({ code: 'ORGANISATION_NAME_TAKEN' });
    expect(
      await prisma.user.count({ where: { email: { in: ['first@hopetrust.example', 'second@hopetrust.example'] } } }),
    ).toBe(1);
  });

  it('refuses an administrator who belongs to another organisation and leaves nothing behind', async () => {
    const actor = await signedInSuperAdmin();
    const service = organisationsOn(prisma);
    await service.create(actor, organisationInput('Hope Trust', 'admin@hopetrust.example'));
    const usersBefore = await prisma.user.count();

    await expect(
      service.create(actor, organisationInput('Light Foundation', 'admin@hopetrust.example')),
    ).rejects.toMatchObject({ code: 'INITIAL_ADMIN_IN_ANOTHER_ORGANISATION' });

    expect(await prisma.user.count()).toBe(usersBefore);
    // The refused organisation was rolled back, so its name is still free.
    await expect(
      service.create(actor, organisationInput('Light Foundation', 'admin@light.example')),
    ).resolves.toMatchObject({ name: 'Light Foundation' });
  });

  describe('organisation settings', () => {
    it('stores a changed contact phone number with an audit entry in the same organisation', async () => {
      const { orgId, admin } = await organisationWithActiveAdmin();

      const updated = await settingsOn(prisma).update(admin, 1, { contactPhone: '+44 20 7946 0000' });

      expect(updated).toMatchObject({ id: orgId, version: 2, contactPhone: '+44 20 7946 0000' });
      const audit = await inTenant(orgId, (tx) =>
        tx.auditLog.findMany({
          select: { orgId: true, actorUserId: true, action: true, entity: true, entityId: true, before: true, after: true },
        }),
      );
      expect(audit).toEqual([
        {
          orgId,
          actorUserId: admin.userId,
          action: 'organisation.settings.updated',
          entity: 'organisation',
          entityId: orgId,
          before: { contactPhone: null },
          after: { contactPhone: '+44 20 7946 0000' },
        },
      ]);
    });

    it('refuses a member without the edit permission and leaves the settings unchanged', async () => {
      const { orgId, admin } = await organisationWithActiveAdmin();
      const member = await prisma.user.create({ data: { email: 'member@hopetrust.example', passwordHash: 'unused' } });
      await inTenant(orgId, async (tx) => {
        const membership = await tx.membership.create({ data: { orgId, userId: member.id }, select: { id: true } });
        const role = await tx.role.findFirstOrThrow({ where: { orgId, name: 'Member' }, select: { id: true } });
        await tx.membershipRole.create({ data: { orgId, membershipId: membership.id, roleId: role.id } });
      });

      await expect(
        settingsOn(prisma).update({ userId: member.id, orgId, impersonating: false }, 1, { contactPhone: '+44 20 7946 0000' }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

      expect(await settingsOn(prisma).get(admin)).toMatchObject({ contactPhone: null, version: 1 });
      expect(await inTenant(orgId, (tx) => tx.auditLog.count())).toBe(0);
    });

    it('lets only one of two simultaneous saves of the same version through', async () => {
      const { orgId, admin } = await organisationWithActiveAdmin();

      const results = await Promise.allSettled([
        settingsOn(prisma).update(admin, 1, { contactPhone: '+44 20 7946 0001' }),
        settingsOn(otherPrisma).update(admin, 1, { contactPhone: '+44 20 7946 0002' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((r) => r.status === 'rejected');
      expect(refused?.status === 'rejected' && refused.reason).toMatchObject({ code: 'STALE_VERSION' });
      expect((await settingsOn(prisma).get(admin)).version).toBe(2);
      expect(await inTenant(orgId, (tx) => tx.auditLog.count())).toBe(1);
    });

    it('refuses a name another organisation uses, even though it cannot see that organisation', async () => {
      const light = await organisationWithActiveAdmin('Light Foundation', 'admin@light.example');
      const hope = await organisationWithActiveAdmin();

      await expect(settingsOn(prisma).update(hope.admin, 1, { name: 'LIGHT FOUNDATION' })).rejects.toMatchObject({
        code: 'ORGANISATION_NAME_TAKEN',
      });

      expect(await settingsOn(prisma).get(hope.admin)).toMatchObject({ name: 'Hope Trust', version: 1 });
      expect(await settingsOn(prisma).get(light.admin)).toMatchObject({ name: 'Light Foundation' });
    });

    it('refuses to update or delete an audit entry', async () => {
      const { orgId, admin } = await organisationWithActiveAdmin();
      await settingsOn(prisma).update(admin, 1, { contactPhone: '+44 20 7946 0000' });

      await expect(inTenant(orgId, (tx) => tx.auditLog.updateMany({ data: { action: 'tampered' } }))).rejects.toThrow();
      await expect(inTenant(orgId, (tx) => tx.auditLog.deleteMany())).rejects.toThrow();

      expect(await inTenant(orgId, (tx) => tx.auditLog.findMany({ select: { action: true } }))).toEqual([
        { action: 'organisation.settings.updated' },
      ]);
    });
  });
});
