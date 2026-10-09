import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedSession } from './session.js';

export const ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED = 'identity:allowWhilePasswordChangeRequired';

/** Marks the few routes (password change, logout) that stay reachable before the password is changed. */
export const AllowWhilePasswordChangeRequired = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED, true);

@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ session?: Partial<AuthenticatedSession> }>();
    if (request.session?.mustChangePassword !== true) return true;

    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed === true) return true;

    throw new ForbiddenException({
      code: 'PASSWORD_CHANGE_REQUIRED',
      detail: 'You must set a new password before continuing.',
    });
  }
}
