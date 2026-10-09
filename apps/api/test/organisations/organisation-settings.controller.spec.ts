import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseIfMatch } from '../../src/organisations/organisation-settings.js';
import { OrganisationSettingsController } from '../../src/organisations/organisation-settings.controller.js';
import { OrganisationSettingsService } from '../../src/organisations/organisation-settings.service.js';
import { OrganisationService } from '../../src/organisations/organisation.service.js';
import { SUPER_ADMIN_ROLE_KEY } from '../../src/platform/platform-roles.js';
import { setupPlatform } from '../../src/platform/setup-platform.js';
import { MEMBER_ROLE_NAME } from '../../src/rbac/default-roles.js';
import { FakeSessionRequest } from '../support/http.js';
import { FakeHasher, InMemoryDatabase, RecordingLogger } from '../support/in-memory-database.js';

const hopeTrust = {
  name: 'Hope Trust',
  country: 'GB',
  defaultCurrency: 'GBP',
  timeZone: 'Europe/London',
  initialAdministratorEmail: 'admin@hopetrust.example',
};

async function installed() {
  const db = new InMemoryDatabase();
  await setupPlatform({ store: db, hasher: new FakeHasher(), logger: new RecordingLogger() }, () => ({
    email: 'root@example.org',
    password: 'initial-Secret-123',
  }));
  const [superAdminId] = db.holderIdsOf(SUPER_ADMIN_ROLE_KEY);
  const created = await new OrganisationService(db).create({ userId: superAdminId, impersonating: false }, hopeTrust);
  const adminId = created.initialAdministrator.userId;
  db.users.get(adminId)!.status = 'active';
  return {
    db,
    orgId: created.id,
    adminId,
    controller: new OrganisationSettingsController(new OrganisationSettingsService(db)),
  };
}

function sessionFor(userId: string, orgId?: string): FakeSessionRequest {
  const request = new FakeSessionRequest();
  request.session.userId = userId;
  request.session.orgId = orgId;
  request.session.mustChangePassword = false;
  return request;
}

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('expected an HTTP exception');
  return error;
}

describe('OrganisationSettingsController', () => {
  it("returns the signed-in administrator's organisation settings with their version", async () => {
    const { orgId, adminId, controller } = await installed();

    expect(await controller.get(sessionFor(adminId, orgId))).toMatchObject({ id: orgId, name: 'Hope Trust', version: 1 });
  });

  it('stores a changed contact phone number for an administrator', async () => {
    const { db, orgId, adminId, controller } = await installed();

    const updated = await controller.update(sessionFor(adminId, orgId), '"1"', { contactPhone: '+44 20 7946 0000' });

    expect(updated).toMatchObject({ contactPhone: '+44 20 7946 0000', version: 2 });
    expect(db.auditLog).toHaveLength(1);
  });

  it('answers a direct request from a member without the permission with 403 and changes nothing', async () => {
    const { db, orgId, adminId, controller } = await installed();
    const membershipId = db.addOrganisationMember(orgId, 'member@hopetrust.example');
    const memberRole = db.roles.find((r) => r.orgId === orgId && r.name === MEMBER_ROLE_NAME)!;
    await db.assignRole(orgId, membershipId, memberRole.id);
    const memberId = db.memberships.find((m) => m.id === membershipId)!.userId;

    const error = await rejection(
      controller.update(sessionFor(memberId, orgId), '"1"', { contactPhone: '+44 20 7946 0000' }),
    );

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(await controller.get(sessionFor(adminId, orgId))).toMatchObject({ contactPhone: null, version: 1 });
    expect(db.auditLog).toEqual([]);
  });

  it('answers 428 when the version is not sent', async () => {
    const { orgId, adminId, controller } = await installed();

    const error = await rejection(
      controller.update(sessionFor(adminId, orgId), undefined, { contactPhone: '+44 20 7946 0000' }),
    );

    expect(error.getStatus()).toBe(428);
    expect(error.getResponse()).toMatchObject({ code: 'IF_MATCH_REQUIRED' });
  });

  it('answers 409 when the settings changed since they were loaded', async () => {
    const { orgId, adminId, controller } = await installed();
    await controller.update(sessionFor(adminId, orgId), '"1"', { contactPhone: '+44 20 7946 0000' });

    const error = await rejection(
      controller.update(sessionFor(adminId, orgId), '"1"', { contactPhone: '+44 20 7946 0999' }),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'STALE_VERSION' });
  });

  it('answers 400 naming an unsupported currency', async () => {
    const { orgId, adminId, controller } = await installed();

    const error = await rejection(controller.update(sessionFor(adminId, orgId), '"1"', { defaultCurrency: 'XYZ' }));

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({
      code: 'VALIDATION',
      errors: [{ field: 'defaultCurrency', message: expect.stringContaining('ISO 4217') }],
    });
  });

  it('refuses a request without a signed-in session', async () => {
    const { controller } = await installed();

    await expect(controller.update(new FakeSessionRequest(), '"1"', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a session that has no organisation', async () => {
    const { adminId, controller } = await installed();

    const error = await rejection(controller.get(sessionFor(adminId)));

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toMatchObject({ code: 'ORGANISATION_REQUIRED' });
  });
});

describe('parseIfMatch', () => {
  it('reads a quoted or bare version number', () => {
    expect(parseIfMatch('"3"')).toBe(3);
    expect(parseIfMatch(' 12 ')).toBe(12);
  });

  it('names no version for a missing, wildcard, weak or malformed header', () => {
    expect(parseIfMatch(undefined)).toBeUndefined();
    expect(parseIfMatch('*')).toBeUndefined();
    expect(parseIfMatch('W/"3"')).toBeUndefined();
    expect(parseIfMatch('"three"')).toBeUndefined();
  });
});
