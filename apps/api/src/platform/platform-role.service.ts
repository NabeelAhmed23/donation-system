import { ConflictError, NotFoundError } from '../common/errors.js';
import { PlatformRoleAssignmentRefusedError } from './errors.js';
import type { PlatformStore } from './platform.store.js';
import { SUPER_ADMIN_ROLE_KEY } from './platform-roles.js';

export interface PlatformActor {
  userId: string;
  platformRoles: readonly string[];
  impersonating: boolean;
}

export class PlatformRoleService {
  constructor(private readonly store: PlatformStore) {}

  async grant(actor: PlatformActor, targetUserId: string, roleKey: string): Promise<void> {
    assertCanManagePlatformRoles(actor);
    await this.store.runExclusive(async (tx) => {
      const role = await tx.findPlatformRoleByKey(roleKey);
      if (!role) throw new NotFoundError('PLATFORM_ROLE_NOT_FOUND', 'Platform role not found');
      if (!(await tx.userExists(targetUserId))) throw new NotFoundError('USER_NOT_FOUND', 'User not found');
      if (await tx.hasPlatformRole(targetUserId, role.id)) return;
      await tx.grantPlatformRole({ userId: targetUserId, roleId: role.id, grantedByUserId: actor.userId });
    });
  }

  async revoke(actor: PlatformActor, targetUserId: string, roleKey: string): Promise<void> {
    assertCanManagePlatformRoles(actor);
    await this.store.runExclusive(async (tx) => {
      const role = await tx.findPlatformRoleByKey(roleKey);
      if (!role) throw new NotFoundError('PLATFORM_ROLE_NOT_FOUND', 'Platform role not found');
      if (!(await tx.hasPlatformRole(targetUserId, role.id))) return;
      if (roleKey === SUPER_ADMIN_ROLE_KEY && (await tx.countRoleHolders(role.id)) <= 1) {
        throw new ConflictError('LAST_SUPER_ADMIN', 'The last super administrator cannot be removed');
      }
      await tx.revokePlatformRole(targetUserId, role.id);
    });
  }
}

function assertCanManagePlatformRoles(actor: PlatformActor): void {
  if (actor.impersonating) {
    throw new PlatformRoleAssignmentRefusedError('Platform roles cannot be changed while impersonating');
  }
  if (!actor.platformRoles.includes(SUPER_ADMIN_ROLE_KEY)) {
    throw new PlatformRoleAssignmentRefusedError('Only a super administrator can assign platform roles');
  }
}
