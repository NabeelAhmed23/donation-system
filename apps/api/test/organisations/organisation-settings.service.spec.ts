import { describe, expect, it } from 'vitest';
import { ConflictError, PreconditionRequiredError } from '../../src/common/errors.js';
import { OrganisationValidationError } from '../../src/organisations/new-organisation.js';
import { OrganisationService } from '../../src/organisations/organisation.service.js';
import {
  ORGANISATION_SETTINGS_UPDATED,
  OrganisationSettingsService,
} from '../../src/organisations/organisation-settings.service.js';
import { SUPER_ADMIN_ROLE_KEY } from '../../src/platform/platform-roles.js';
import { setupPlatform } from '../../src/platform/setup-platform.js';
import { MEMBER_ROLE_NAME } from '../../src/rbac/default-roles.js';
import { PermissionDeniedError } from '../../src/rbac/permissions.js';
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

const changedAt = new Date('2026-10-09T12:00:00Z');

async function platform() {
  const db = new InMemoryDatabase();
  await setupPlatform({ store: db, hasher: new FakeHasher(), logger: new RecordingLogger() }, () => ({
    email: 'root@example.org',
    password: 'initial-Secret-123',
  }));
  const [superAdminId] = db.holderIdsOf(SUPER_ADMIN_ROLE_KEY);
  const onboarding = new OrganisationService(db);
  // Creates the organisation and activates its administrator, standing in for invitation acceptance.
  const createOrganisation = async (input: typeof hopeTrust) => {
    const created = await onboarding.create({ userId: superAdminId, impersonating: false }, input);
    const userId = created.initialAdministrator.userId;
    db.users.get(userId)!.status = 'active';
    return { orgId: created.id, admin: { userId, orgId: created.id, impersonating: false } };
  };
  return { db, createOrganisation, service: new OrganisationSettingsService(db, () => changedAt) };
}

async function hopeTrustWithAdmin() {
  const context = await platform();
  return { ...context, ...(await context.createOrganisation(hopeTrust)) };
}

async function memberOf(db: InMemoryDatabase, orgId: string) {
  const membershipId = db.addOrganisationMember(orgId, 'member@hopetrust.example');
  const memberRole = db.roles.find((r) => r.orgId === orgId && r.name === MEMBER_ROLE_NAME)!;
  await db.assignRole(orgId, membershipId, memberRole.id);
  return { userId: db.memberships.find((m) => m.id === membershipId)!.userId, orgId, impersonating: false };
}

describe('OrganisationSettingsService', () => {
  it('shows an administrator their organisation settings', async () => {
    const { orgId, admin, service } = await hopeTrustWithAdmin();

    expect(await service.get(admin)).toEqual({
      id: orgId,
      version: 1,
      name: 'Hope Trust',
      description: null,
      country: 'GB',
      defaultCurrency: 'GBP',
      timeZone: 'Europe/London',
      contactEmail: null,
      contactPhone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      postalCode: null,
    });
  });

  it('stores a new contact phone number and audits who changed it, when, and the old and new values', async () => {
    const { db, orgId, admin, service } = await hopeTrustWithAdmin();

    const updated = await service.update(admin, 1, { contactPhone: '+44 20 7946 0000' });

    expect(updated).toMatchObject({ id: orgId, version: 2, name: 'Hope Trust', contactPhone: '+44 20 7946 0000' });
    expect(await service.get(admin)).toEqual(updated);
    expect(db.auditLog).toEqual([
      {
        orgId,
        actorUserId: admin.userId,
        action: ORGANISATION_SETTINGS_UPDATED,
        entity: 'organisation',
        entityId: orgId,
        before: { contactPhone: null },
        after: { contactPhone: '+44 20 7946 0000' },
        at: changedAt,
      },
    ]);

    await service.update(admin, 2, { contactPhone: '+44 20 7946 0999' });

    expect(db.auditLog[1]).toMatchObject({
      before: { contactPhone: '+44 20 7946 0000' },
      after: { contactPhone: '+44 20 7946 0999' },
    });
  });

  it('refuses a member without the organisation-settings edit permission and changes nothing', async () => {
    const { db, orgId, admin, service } = await hopeTrustWithAdmin();
    const member = await memberOf(db, orgId);
    const before = await service.get(admin);

    const error = await service.update(member, 1, { contactPhone: '+44 20 7946 0000' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PermissionDeniedError);
    expect(error).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(await service.get(admin)).toEqual(before);
    expect(db.auditLog).toEqual([]);
  });

  it('refuses a member before looking at the version or the input', async () => {
    const { db, orgId, service } = await hopeTrustWithAdmin();
    const member = await memberOf(db, orgId);

    await expect(service.update(member, undefined, { defaultCurrency: 'XYZ' })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('refuses a member who tries to read the settings without the view permission', async () => {
    const { db, orgId, service } = await hopeTrustWithAdmin();
    const member = await memberOf(db, orgId);

    await expect(service.get(member)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it("refuses another organisation's administrator", async () => {
    const { db, createOrganisation, orgId, admin, service } = await hopeTrustWithAdmin();
    const light = await createOrganisation(lightFoundation);
    const before = await service.get(admin);

    await expect(
      service.update({ ...light.admin, orgId }, 1, { contactPhone: '+44 20 7946 0000' }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await service.get(admin)).toEqual(before);
    expect(db.auditLog).toEqual([]);
  });

  it('refuses an administrator whose account is suspended', async () => {
    const { db, admin, service } = await hopeTrustWithAdmin();
    db.users.get(admin.userId)!.status = 'suspended';

    await expect(service.update(admin, 1, { contactPhone: '+44 20 7946 0000' })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it('refuses a change while impersonating', async () => {
    const { db, admin, service } = await hopeTrustWithAdmin();

    await expect(
      service.update({ ...admin, impersonating: true }, 1, { contactPhone: '+44 20 7946 0000' }),
    ).rejects.toMatchObject({ code: 'IMPERSONATION_RESTRICTED' });
    expect(db.auditLog).toEqual([]);
  });

  it('changes only the default currency setting when the default currency changes', async () => {
    const { db, orgId, admin, service } = await hopeTrustWithAdmin();
    const before = await service.get(admin);

    const updated = await service.update(admin, 1, { defaultCurrency: 'usd' });

    // Donations are not modelled yet; this update writes only the organisation row and its audit entry.
    expect(updated).toEqual({ ...before, defaultCurrency: 'USD', version: 2 });
    expect(db.auditLog).toEqual([
      expect.objectContaining({ orgId, before: { defaultCurrency: 'GBP' }, after: { defaultCurrency: 'USD' } }),
    ]);
  });

  it.each(['XYZ', 'POUNDS', 'GB'])('rejects the unsupported currency code %s and changes nothing', async (code) => {
    const { db, admin, service } = await hopeTrustWithAdmin();

    const error = await service.update(admin, 1, { defaultCurrency: code }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OrganisationValidationError);
    expect((error as OrganisationValidationError).fieldErrors).toEqual([
      { field: 'defaultCurrency', message: expect.stringContaining('ISO 4217') },
    ]);
    expect((await service.get(admin)).defaultCurrency).toBe('GBP');
    expect(db.auditLog).toEqual([]);
  });

  it('stores a new IANA time zone and rejects unknown zones and bare offsets', async () => {
    const { admin, service } = await hopeTrustWithAdmin();

    await expect(service.update(admin, 1, { timeZone: 'Mars/Olympus' })).rejects.toBeInstanceOf(OrganisationValidationError);
    await expect(service.update(admin, 1, { timeZone: '+05:00' })).rejects.toBeInstanceOf(OrganisationValidationError);

    expect(await service.update(admin, 1, { timeZone: 'Asia/Karachi' })).toMatchObject({ timeZone: 'Asia/Karachi', version: 2 });
  });

  it('refuses a save based on a version someone else has already changed', async () => {
    const { db, admin, service } = await hopeTrustWithAdmin();
    await service.update(admin, 1, { contactPhone: '+44 20 7946 0000' });

    const error = await service.update(admin, 1, { contactPhone: '+44 20 7946 0999' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: 'STALE_VERSION' });
    expect((await service.get(admin)).contactPhone).toBe('+44 20 7946 0000');
    expect(db.auditLog).toHaveLength(1);
  });

  it('lets only one of two simultaneous saves of the same version through', async () => {
    const { db, admin, service } = await hopeTrustWithAdmin();

    const results = await Promise.allSettled([
      service.update(admin, 1, { contactPhone: '+44 20 7946 0001' }),
      service.update(admin, 1, { contactPhone: '+44 20 7946 0002' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected');
    expect(refused?.status === 'rejected' && refused.reason).toMatchObject({ code: 'STALE_VERSION' });
    expect((await service.get(admin)).contactPhone).toBe('+44 20 7946 0001');
    expect(db.auditLog).toHaveLength(1);
  });

  it('requires the version the change is based on', async () => {
    const { db, admin, service } = await hopeTrustWithAdmin();

    const error = await service.update(admin, undefined, { contactPhone: '+44 20 7946 0000' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PreconditionRequiredError);
    expect(error).toMatchObject({ code: 'IF_MATCH_REQUIRED' });
    expect(db.auditLog).toEqual([]);
  });

  it('names each invalid or unknown field and changes nothing', async () => {
    const { db, admin, service } = await hopeTrustWithAdmin();

    const error = await service
      .update(admin, 1, { id: 'another-org', name: '   ', contactEmail: 'not-an-email', contactPhone: 'call me' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OrganisationValidationError);
    expect((error as OrganisationValidationError).fieldErrors.map((e) => e.field)).toEqual([
      'id',
      'name',
      'contactEmail',
      'contactPhone',
    ]);
    expect((await service.get(admin)).version).toBe(1);
    expect(db.auditLog).toEqual([]);
  });

  it('normalises contact details and clears an optional detail sent empty', async () => {
    const { db, admin, service } = await hopeTrustWithAdmin();

    const first = await service.update(admin, 1, {
      contactEmail: ' Info@HopeTrust.example ',
      addressLine1: ' 1 High Street ',
      city: 'London',
    });
    expect(first).toMatchObject({ contactEmail: 'info@hopetrust.example', addressLine1: '1 High Street', city: 'London' });

    const second = await service.update(admin, 2, { city: '', addressLine1: null });

    expect(second).toMatchObject({ city: null, addressLine1: null, contactEmail: 'info@hopetrust.example', version: 3 });
    expect(db.auditLog[1]).toMatchObject({
      before: { addressLine1: '1 High Street', city: 'London' },
      after: { addressLine1: null, city: null },
    });
  });

  it('refuses a name another organisation already uses, ignoring case', async () => {
    const { db, createOrganisation, admin, service } = await hopeTrustWithAdmin();
    await createOrganisation(lightFoundation);

    await expect(service.update(admin, 1, { name: 'LIGHT FOUNDATION' })).rejects.toMatchObject({
      code: 'ORGANISATION_NAME_TAKEN',
    });
    expect((await service.get(admin)).name).toBe('Hope Trust');
    expect(db.auditLog).toEqual([]);
  });

  it('records nothing when the submitted values match what is stored', async () => {
    const { db, admin, service } = await hopeTrustWithAdmin();

    const result = await service.update(admin, 1, { name: 'Hope Trust', country: 'gb' });

    expect(result.version).toBe(1);
    expect(db.auditLog).toEqual([]);
  });
});
