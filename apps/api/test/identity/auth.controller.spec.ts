import 'reflect-metadata';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AuthController } from '../../src/identity/auth.controller.js';
import { AuthService } from '../../src/identity/auth.service.js';
import { PasswordChangeRequiredGuard } from '../../src/identity/password-change-required.guard.js';
import { setupPlatform } from '../../src/platform/setup-platform.js';
import { executionContextFor, FakeSessionRequest } from '../support/http.js';
import { FakeHasher, InMemoryDatabase, RecordingLogger } from '../support/in-memory-database.js';

const initial = { email: 'root@example.org', password: 'initial-Secret-123' };
const newPassword = 'brand-new-Secret-456';

/** Stands in for any protected route, e.g. the super administrator's organisation list. */
class PlatformController {
  listOrganisations(): void {}
}

async function installed() {
  const db = new InMemoryDatabase();
  const hasher = new FakeHasher();
  await setupPlatform({ store: db, hasher, logger: new RecordingLogger() }, () => initial);
  return {
    db,
    controller: new AuthController(new AuthService(db, hasher)),
    guard: new PasswordChangeRequiredGuard(new Reflector()),
  };
}

async function signedIn() {
  const context = await installed();
  const request = new FakeSessionRequest();
  const result = await context.controller.login(request, initial);
  return { ...context, request, result };
}

function canReachProtectedRoute(guard: PasswordChangeRequiredGuard, request: FakeSessionRequest): boolean {
  try {
    return guard.canActivate(
      executionContextFor(request, PlatformController.prototype.listOrganisations, PlatformController),
    );
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe('AuthController', () => {
  it('signs the initial super administrator in to a rotated session that must change its password', async () => {
    const { db, request, result, guard } = await signedIn();
    const [userId] = [...db.users.keys()];

    expect(result).toEqual({ mustChangePassword: true });
    expect(request.session.id).toBe(2);
    expect(request.session).toMatchObject({ userId, mustChangePassword: true });
    expect(canReachProtectedRoute(guard, request)).toBe(false);
  });

  it('unlocks every route once a new password is set, and rotates the session again', async () => {
    const { db, controller, request, guard } = await signedIn();
    const sessionIdBefore = request.session.id;
    const userId = request.session.userId;

    const result = await controller.changePassword(request, { currentPassword: initial.password, newPassword });

    expect(result).toEqual({ mustChangePassword: false });
    expect(request.session.id).not.toBe(sessionIdBefore);
    expect(request.session).toMatchObject({ userId, mustChangePassword: false });
    expect(db.users.get(userId!)?.mustChangePassword).toBe(false);
    expect(canReachProtectedRoute(guard, request)).toBe(true);
  });

  it('keeps the account locked when the bootstrap password is offered as the new one', async () => {
    const { controller, request, guard } = await signedIn();

    await expect(
      controller.changePassword(request, { currentPassword: initial.password, newPassword: initial.password }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(request.session.mustChangePassword).toBe(true);
    expect(canReachProtectedRoute(guard, request)).toBe(false);
  });

  it('refuses a password change with the wrong current password', async () => {
    const { controller, request } = await signedIn();

    await expect(
      controller.changePassword(request, { currentPassword: 'wrong-Secret-000', newPassword }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(request.session.mustChangePassword).toBe(true);
  });

  it('refuses a password change without a signed-in session', async () => {
    const { controller } = await installed();

    await expect(
      controller.changePassword(new FakeSessionRequest(), { currentPassword: initial.password, newPassword }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('answers invalid credentials generically and establishes no session', async () => {
    const { controller } = await installed();
    const request = new FakeSessionRequest();

    await expect(controller.login(request, { email: initial.email, password: 'wrong-Secret-000' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.session.id).toBe(1);
    expect(request.session.userId).toBeUndefined();
  });

  it('rejects a login body without a password', async () => {
    const { controller } = await installed();

    await expect(controller.login(new FakeSessionRequest(), { email: initial.email })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not ask for another change on the next sign-in', async () => {
    const { controller, request } = await signedIn();
    await controller.changePassword(request, { currentPassword: initial.password, newPassword });

    const next = new FakeSessionRequest();
    expect(await controller.login(next, { email: initial.email, password: newPassword })).toEqual({
      mustChangePassword: false,
    });
  });

  it('destroys the session on logout', async () => {
    const { controller, request } = await signedIn();
    const session = request.session;

    await controller.logout(request);

    expect(session.destroyed).toBe(true);
  });
});
