import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedSession } from './session.js';

export const ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED = 'identity:allowWhilePasswordChangeRequired';

/** Marks the few routes (login, password change, logout) that stay reachable before the password is changed. */
export const AllowWhilePasswordChangeRequired = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED, true);

@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const session = context.switchToHttp().getRequest<{ session?: Partial<AuthenticatedSession> }>().session;
    // No identity yet: whether the route needs one is the session guard's decision.
    if (!session?.userId) return true;
    // Fail closed: an authenticated session passes only when the flag was explicitly cleared.
    if (session.mustChangePassword === false) return true;

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
