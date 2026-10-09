import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AuthController } from '../../src/identity/auth.controller.js';
import {
  AllowWhilePasswordChangeRequired,
  PasswordChangeRequiredGuard,
} from '../../src/identity/password-change-required.guard.js';
import { executionContextFor, type ControllerClass, type RouteHandler } from '../support/http.js';

class ExampleController {
  @AllowWhilePasswordChangeRequired()
  allowed(): void {}

  guarded(): void {}
}

@AllowWhilePasswordChangeRequired()
class AllowedController {
  anything(): void {}
}

const guard = new PasswordChangeRequiredGuard(new Reflector());

function check(
  request: object,
  handler: RouteHandler = ExampleController.prototype.guarded,
  controller: ControllerClass = ExampleController,
): boolean {
  return guard.canActivate(executionContextFor(request, handler, controller));
}

function refusal(run: () => unknown): ForbiddenException {
  try {
    run();
  } catch (error) {
    if (error instanceof ForbiddenException) return error;
    throw error;
  }
  throw new Error('expected the guard to refuse the request');
}

describe('PasswordChangeRequiredGuard', () => {
  it('leaves requests without an identity to the session guard', () => {
    expect(check({})).toBe(true);
    expect(check({ session: {} })).toBe(true);
  });

  it('lets an authenticated session through once the flag is cleared', () => {
    expect(check({ session: { userId: 'u1', mustChangePassword: false } })).toBe(true);
  });

  it('refuses an unmarked route while a password change is required', () => {
    const error = refusal(() => check({ session: { userId: 'u1', mustChangePassword: true } }));

    expect(error.getResponse()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  });

  it('fails closed when an authenticated session has no flag', () => {
    const error = refusal(() => check({ session: { userId: 'u1' } }));

    expect(error.getResponse()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  });

  it('allows a route marked on the method', () => {
    expect(check({ session: { userId: 'u1', mustChangePassword: true } }, ExampleController.prototype.allowed)).toBe(true);
  });

  it('allows a route marked on the controller', () => {
    expect(
      check({ session: { userId: 'u1', mustChangePassword: true } }, AllowedController.prototype.anything, AllowedController),
    ).toBe(true);
  });

  it('keeps exactly login, password change and logout reachable on the auth controller', () => {
    const session = { userId: 'u1', mustChangePassword: true };

    expect(check({ session }, AuthController.prototype.login, AuthController)).toBe(true);
    expect(check({ session }, AuthController.prototype.changePassword, AuthController)).toBe(true);
    expect(check({ session }, AuthController.prototype.logout, AuthController)).toBe(true);
  });
});
