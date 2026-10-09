import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/common/errors.js';
import { AuthService } from '../../src/identity/auth.service.js';
import { OrganisationValidationError } from '../../src/organisations/new-organisation.js';
import { OrganisationService } from '../../src/organisations/organisation.service.js';
import { PlatformAccessRefusedError } from '../../src/platform/errors.js';
import { SUPER_ADMIN_ROLE_KEY } from '../../src/platform/platform-roles.js';
import { setupPlatform } from '../../src/platform/setup-platform.js';
import { DEFAULT_ORGANISATION_ROLE_NAMES, ORGANISATION_ADMINISTRATOR_ROLE_NAME } from '../../src/rbac/default-roles.js';
import { FakeHasher, InMemoryDatabase, RecordingLogger } from '../support/in-memory-database.js';

const hopeTrust = {
  name: 'Hope Trust',
  country: 'GB',
  defaultCurrency: 'GBP',
  timeZone: 'Europe/London',
  initialAdministratorEmail: 'admin@hopetrust.example',
};

const lightFoundation = {
  name: 'Light Foundation',
  country: 'PK',
  defaultCurrency: 'PKR',
  timeZone: 'Asia/Karachi',
  initialAdministratorEmail: 'admin@light.example',
};

async function platform() {
  const db = new InMemoryDatabase();
  const hasher = new FakeHasher();
  await setupPlatform({ store: db, hasher, logger: new RecordingLogger() }, () => ({
    email: 'root@example.org',
    password: 'initial-Secret-123',
  }));
  const [superAdminId] = db.holderIdsOf(SUPER_ADMIN_ROLE_KEY);
  return { db, hasher, superAdmin: { userId: superAdminId, impersonating: false }, service: new OrganisationService(db) };
}

describe('OrganisationService.create', () => {
  it('creates the organisation with its settings and an administrator who belongs to it alone', async () => {
    const { db, superAdmin, service } = await platform();

    const created = await service.create(superAdmin, hopeTrust);

    expect(created).toEqual({
      id: expect.any(String),
      name: 'Hope Trust',
      country: 'GB',
      defaultCurrency: 'GBP',
      timeZone: 'Europe/London',
      initialAdministrator: { userId: expect.any(String), email: 'admin@hopetrust.example', status: 'invited' },
    });
    expect(db.organisations).toEqual([
      { id: created.id, name: 'Hope Trust', country: 'GB', defaultCurrency: 'GBP', timeZone: 'Europe/London' },
    ]);

    const adminId = created.initialAdministrator.userId;
    expect(db.users.get(adminId)).toMatchObject({ email: 'admin@hopetrust.example', status: 'invited', passwordHash: null });
    const adminMemberships = db.memberships.filter((m) => m.userId === adminId);
    expect(adminMemberships).toEqual([{ id: expect.any(String), orgId: created.id, userId: adminId }]);
    const adminRole = db.roles.find((r) => r.orgId === created.id && r.name === ORGANISATION_ADMINISTRATOR_ROLE_NAME);
    expect(db.membershipRoles).toEqual([{ orgId: created.id, membershipId: adminMemberships[0].id, roleId: adminRole?.id }]);
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).not.toContain(adminId);
    // Donation types, donations and receipts are not modelled yet, so a new organisation has none by construction.
  });

  it('gives a new organisation only its own default roles', async () => {
    const { db, superAdmin, service } = await platform();

    const created = await service.create(superAdmin, hopeTrust);

    expect(db.roles.filter((r) => r.orgId === created.id).map((r) => r.name)).toEqual([...DEFAULT_ORGANISATION_ROLE_NAMES]);
    expect(db.roles.every((r) => r.orgId === created.id)).toBe(true);
  });

  it('normalises the submitted values', async () => {
    const { db, superAdmin, service } = await platform();

    const created = await service.create(superAdmin, {
      name: '  Hope Trust ',
      country: 'gb',
      defaultCurrency: 'gbp',
      timeZone: 'Europe/London',
      initialAdministratorEmail: ' Admin@HopeTrust.example ',
    });

    expect(db.organisations).toEqual([
      { id: created.id, name: 'Hope Trust', country: 'GB', defaultCurrency: 'GBP', timeZone: 'Europe/London' },
    ]);
    expect(created.initialAdministrator.email).toBe('admin@hopetrust.example');
  });

  it('copies nothing from an existing organisation into a new one', async () => {
    const { db, superAdmin, service } = await platform();
    const hope = await service.create(superAdmin, hopeTrust);
    db.addOrganisationMember(hope.id, 'member@hopetrust.example');
    db.addOrganisationRole(hope.id, 'Treasurer');
    const hopeRoleIds = db.roles.filter((r) => r.orgId === hope.id).map((r) => r.id);
    const hopeUserIds = db.memberships.filter((m) => m.orgId === hope.id).map((m) => m.userId);

    const light = await service.create(superAdmin, lightFoundation);

    const lightRoles = db.roles.filter((r) => r.orgId === light.id);
    expect(lightRoles.map((r) => r.name)).toEqual([...DEFAULT_ORGANISATION_ROLE_NAMES]);
    expect(lightRoles.filter((r) => hopeRoleIds.includes(r.id))).toEqual([]);
    expect(db.memberships.filter((m) => m.orgId === light.id).map((m) => m.userId)).toEqual([
      light.initialAdministrator.userId,
    ]);
    expect(hopeUserIds).not.toContain(light.initialAdministrator.userId);
    const lightAssignments = db.membershipRoles.filter((mr) => mr.orgId === light.id);
    expect(lightAssignments).toHaveLength(1);
    expect(lightAssignments.filter((mr) => hopeRoleIds.includes(mr.roleId))).toEqual([]);
    expect(db.organisations.find((o) => o.id === light.id)).toEqual({ id: light.id, ...settingsOf(lightFoundation) });
    // Hope Trust is unchanged.
    expect(db.roles.filter((r) => r.orgId === hope.id).map((r) => r.id)).toEqual(hopeRoleIds);
    expect(db.memberships.filter((m) => m.orgId === hope.id).map((m) => m.userId)).toEqual(hopeUserIds);
  });

  it('names every missing field and creates nothing', async () => {
    const { db, superAdmin, service } = await platform();

    const error = await service
      .create(superAdmin, { initialAdministratorEmail: 'admin@hopetrust.example' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OrganisationValidationError);
    const validation = error as OrganisationValidationError;
    expect(validation.fieldErrors.map((e) => e.field)).toEqual(['name', 'country', 'defaultCurrency', 'timeZone']);
    expect(validation.message).toContain('Name is required');
    expect(validation.message).toContain('Country is required');
    expect(validation.message).toContain('Default currency is required');
    expect(validation.message).toContain('Time zone is required');
    expect(db.organisations).toEqual([]);
    expect(db.users.size).toBe(1);
  });

  it.each(['name', 'country', 'defaultCurrency', 'timeZone'] as const)('names a blank %s and creates nothing', async (field) => {
    const { db, superAdmin, service } = await platform();

    const error = await service.create(superAdmin, { ...hopeTrust, [field]: '   ' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OrganisationValidationError);
    expect((error as OrganisationValidationError).fieldErrors).toEqual([
      { field, message: expect.stringContaining('is required') },
    ]);
    expect(db.organisations).toEqual([]);
    expect(db.roles).toEqual([]);
  });

  it('names invalid country, currency, time zone and email values', async () => {
    const { db, superAdmin, service } = await platform();

    const error = await service
      .create(superAdmin, {
        name: 'Hope Trust',
        country: 'GBR',
        defaultCurrency: 'POUNDS',
        timeZone: 'Mars/Olympus',
        initialAdministratorEmail: 'not-an-email',
      })
      .catch((e: unknown) => e);

    expect((error as OrganisationValidationError).fieldErrors.map((e) => e.field)).toEqual([
      'country',
      'defaultCurrency',
      'timeZone',
      'initialAdministratorEmail',
    ]);
    expect(db.organisations).toEqual([]);
  });

  it('refuses an administrator who already belongs to another organisation and creates nothing', async () => {
    const { db, superAdmin, service } = await platform();
    await service.create(superAdmin, hopeTrust);
    const usersBefore = db.users.size;
    const rolesBefore = db.roles.length;

    const error = await service
      .create(superAdmin, { ...lightFoundation, initialAdministratorEmail: hopeTrust.initialAdministratorEmail })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: 'INITIAL_ADMIN_IN_ANOTHER_ORGANISATION' });
    expect((error as Error).message).toMatch(/already belongs to an organisation/);
    expect((error as Error).message).toMatch(/migrated/);
    expect(db.organisations.map((o) => o.name)).toEqual(['Hope Trust']);
    expect(db.users.size).toBe(usersBefore);
    expect(db.roles).toHaveLength(rolesBefore);
  });

  it('refuses an active member of another organisation as the initial administrator', async () => {
    const { db, superAdmin, service } = await platform();
    db.addOrganisationMember('org-a', 'person@org-a.example');

    await expect(
      service.create(superAdmin, { ...hopeTrust, initialAdministratorEmail: 'person@org-a.example' }),
    ).rejects.toMatchObject({ code: 'INITIAL_ADMIN_IN_ANOTHER_ORGANISATION' });
    expect(db.organisations).toEqual([]);
    expect(db.roles).toEqual([]);
  });

  it('refuses a platform administrator as the initial administrator', async () => {
    const { db, superAdmin, service } = await platform();

    await expect(
      service.create(superAdmin, { ...hopeTrust, initialAdministratorEmail: 'root@example.org' }),
    ).rejects.toMatchObject({ code: 'INITIAL_ADMIN_IS_PLATFORM_ACCOUNT' });
    expect(db.organisations).toEqual([]);
    expect(db.memberships).toEqual([]);
  });

  it('makes an existing user without an organisation the administrator', async () => {
    const { db, superAdmin, service } = await platform();
    const userId = db.addUser('orphan@example.org');

    const created = await service.create(superAdmin, { ...hopeTrust, initialAdministratorEmail: 'orphan@example.org' });

    expect(created.initialAdministrator).toEqual({ userId, email: 'orphan@example.org', status: 'active' });
    expect(db.memberships).toEqual([{ id: expect.any(String), orgId: created.id, userId }]);
  });

  it('refuses an organisation administrator before looking at the input', async () => {
    const { db, service } = await platform();
    const membershipId = db.addOrganisationMember('org-a', 'admin@org-a.example');
    const orgAdmin = { userId: db.memberships.find((m) => m.id === membershipId)!.userId, impersonating: false };

    await expect(service.create(orgAdmin, hopeTrust)).rejects.toBeInstanceOf(PlatformAccessRefusedError);
    await expect(service.create(orgAdmin, {})).rejects.toBeInstanceOf(PlatformAccessRefusedError);
    expect(db.organisations).toEqual([]);
  });

  it('refuses a super administrator who is impersonating', async () => {
    const { db, superAdmin, service } = await platform();

    await expect(service.create({ ...superAdmin, impersonating: true }, hopeTrust)).rejects.toBeInstanceOf(
      PlatformAccessRefusedError,
    );
    expect(db.organisations).toEqual([]);
  });

  it('refuses a suspended super administrator', async () => {
    const { db, superAdmin, service } = await platform();
    db.users.get(superAdmin.userId)!.status = 'suspended';

    await expect(service.create(superAdmin, hopeTrust)).rejects.toBeInstanceOf(PlatformAccessRefusedError);
    expect(db.organisations).toEqual([]);
  });

  it('creates only one organisation when the same name is submitted twice at once, ignoring case', async () => {
    const { db, superAdmin, service } = await platform();

    const results = await Promise.allSettled([
      service.create(superAdmin, { ...hopeTrust, initialAdministratorEmail: 'first@hopetrust.example' }),
      service.create(superAdmin, { ...hopeTrust, name: 'HOPE TRUST', initialAdministratorEmail: 'second@hopetrust.example' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected');
    expect(refused?.status === 'rejected' && refused.reason).toMatchObject({ code: 'ORGANISATION_NAME_TAKEN' });
    expect(db.organisations).toHaveLength(1);
    expect([...db.users.values()].map((u) => u.email)).not.toContain('second@hopetrust.example');
  });

  it('leaves the initial administrator invited, unable to sign in until they accept', async () => {
    const { db, hasher, superAdmin, service } = await platform();
    const created = await service.create(superAdmin, hopeTrust);
    const auth = new AuthService(db, hasher);
    const verifyCallsBefore = hasher.verifyCalls;

    expect(created.initialAdministrator.status).toBe('invited');
    expect(await auth.login(hopeTrust.initialAdministratorEmail, 'any-Password-123')).toEqual({ ok: false });
    // Same cost as an unknown email, so the response does not reveal that the account exists.
    expect(hasher.verifyCalls).toBe(verifyCallsBefore + 1);
  });
});

function settingsOf(input: typeof lightFoundation) {
  return { name: input.name, country: input.country, defaultCurrency: input.defaultCurrency, timeZone: input.timeZone };
}
