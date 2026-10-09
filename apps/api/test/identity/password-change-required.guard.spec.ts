import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import {
  AllowWhilePasswordChangeRequired,
  PasswordChangeRequiredGuard,
} from '../../src/identity/password-change-required.guard.js';

class AuthController {
  @AllowWhilePasswordChangeRequired()
  changePassword(): void {}

  @AllowWhilePasswordChangeRequired()
  logout(): void {}
}

class OrganisationsController {
  create(): void {}
}

function contextFor(controller: new () => object, handler: () => void, session?: object): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ session }) }),
  } as unknown as ExecutionContext;
}

const guard = new PasswordChangeRequiredGuard(new Reflector());
const mustChange = { userId: 'u1', mustChangePassword: true };

describe('PasswordChangeRequiredGuard', () => {
  it('refuses any other route while a password change is required', () => {
    const context = contextFor(OrganisationsController, OrganisationsController.prototype.create, mustChange);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    }
  });

  it('allows the password change and logout routes', () => {
    expect(guard.canActivate(contextFor(AuthController, AuthController.prototype.changePassword, mustChange))).toBe(true);
    expect(guard.canActivate(contextFor(AuthController, AuthController.prototype.logout, mustChange))).toBe(true);
  });

  it('allows every route once the password has been changed', () => {
    const session = { userId: 'u1', mustChangePassword: false };

    expect(guard.canActivate(contextFor(OrganisationsController, OrganisationsController.prototype.create, session))).toBe(true);
  });

  it('leaves unauthenticated requests to the session guard', () => {
    expect(guard.canActivate(contextFor(OrganisationsController, OrganisationsController.prototype.create))).toBe(true);
  });
});
