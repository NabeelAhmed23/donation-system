import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@cms/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganisationService } from '../../src/organisations/organisation.service.js';
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
    await prisma.$executeRaw`TRUNCATE TABLE "user_platform_roles", "platform_roles", "membership_roles", "roles", "memberships", "organisations", "users"`;
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
});
