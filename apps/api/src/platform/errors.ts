import { ForbiddenError } from '../common/errors.js';

export class PlatformRoleAssignmentRefusedError extends ForbiddenError {
  constructor(message: string) {
    super('PLATFORM_ROLE_ASSIGNMENT_REFUSED', message);
  }
}

export class PlatformAccessRefusedError extends ForbiddenError {
  constructor(message: string) {
    super('PLATFORM_ACCESS_REFUSED', message);
  }
}
