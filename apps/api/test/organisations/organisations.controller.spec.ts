import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { OrganisationService } from '../../src/organisations/organisation.service.js';
import { OrganisationsController } from '../../src/organisations/organisations.controller.js';
import { SUPER_ADMIN_ROLE_KEY } from '../../src/platform/platform-roles.js';
import { setupPlatform } from '../../src/platform/setup-platform.js';
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
  return { db, controller: new OrganisationsController(new OrganisationService(db)) };
}

function sessionFor(userId: string): FakeSessionRequest {
  const request = new FakeSessionRequest();
  request.session.userId = userId;
  request.session.mustChangePassword = false;
  return request;
}

async function signedInSuperAdmin() {
  const context = await installed();
  const [superAdminId] = context.db.holderIdsOf(SUPER_ADMIN_ROLE_KEY);
  return { ...context, request: sessionFor(superAdminId) };
}

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('expected an HTTP exception');
  return error;
}

describe('OrganisationsController', () => {
  it('creates an organisation for a signed-in super administrator', async () => {
    const { db, controller, request } = await signedInSuperAdmin();

    const created = await controller.create(request, hopeTrust);

    expect(created).toMatchObject({
      name: 'Hope Trust',
      country: 'GB',
      defaultCurrency: 'GBP',
      timeZone: 'Europe/London',
      initialAdministrator: { email: 'admin@hopetrust.example', status: 'invited' },
    });
    expect(db.organisations).toHaveLength(1);
  });

  it('refuses an organisation administrator with 403', async () => {
    const { db, controller } = await installed();
    const membershipId = db.addOrganisationMember('org-a', 'admin@org-a.example');
    const request = sessionFor(db.memberships.find((m) => m.id === membershipId)!.userId);

    const error = await rejection(controller.create(request, hopeTrust));

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toMatchObject({ code: 'PLATFORM_ACCESS_REFUSED' });
    expect(db.organisations).toEqual([]);
  });

  it('refuses a super administrator session that is impersonating', async () => {
    const { db, controller, request } = await signedInSuperAdmin();
    request.session.impersonationSessionId = 'impersonation-1';

    await expect(controller.create(request, hopeTrust)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.organisations).toEqual([]);
  });

  it('refuses a request without a signed-in session', async () => {
    const { db, controller } = await installed();

    await expect(controller.create(new FakeSessionRequest(), hopeTrust)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.organisations).toEqual([]);
  });

  it('answers 400 naming each missing field', async () => {
    const { db, controller, request } = await signedInSuperAdmin();

    const error = await rejection(controller.create(request, { name: 'Hope Trust', initialAdministratorEmail: 'a@b.example' }));

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({
      code: 'VALIDATION',
      errors: [
        { field: 'country', message: 'Country is required' },
        { field: 'defaultCurrency', message: 'Default currency is required' },
        { field: 'timeZone', message: 'Time zone is required' },
      ],
    });
    expect(db.organisations).toEqual([]);
  });

  it('answers 409 when the administrator already belongs to another organisation', async () => {
    const { db, controller, request } = await signedInSuperAdmin();
    db.addOrganisationMember('org-a', 'admin@hopetrust.example');

    const error = await rejection(controller.create(request, hopeTrust));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      code: 'INITIAL_ADMIN_IN_ANOTHER_ORGANISATION',
      detail: expect.stringContaining('must be migrated'),
    });
    expect(db.organisations).toEqual([]);
  });
});
