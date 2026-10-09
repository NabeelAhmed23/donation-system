import { NotFoundError } from '../common/errors.js';
import { PlatformRoleAssignmentRefusedError } from '../platform/errors.js';
import type { RoleAssignmentStore } from './role-assignment.store.js';

export interface OrgActor {
  userId: string;
  orgId: string;
}

export class RoleAssignmentService {
  constructor(private readonly store: RoleAssignmentStore) {}

  async assignRole(actor: OrgActor, input: { membershipId: string; roleId: string }): Promise<void> {
    if (await this.store.isPlatformRole(input.roleId)) {
      throw new PlatformRoleAssignmentRefusedError('Platform roles cannot be assigned from an organisation');
    }
    if (!(await this.store.findMembership(actor.orgId, input.membershipId))) {
      throw new NotFoundError('MEMBER_NOT_FOUND', 'Member not found');
    }
    if (!(await this.store.findRole(actor.orgId, input.roleId))) {
      throw new NotFoundError('ROLE_NOT_FOUND', 'Role not found');
    }
    if (await this.store.hasRole(actor.orgId, input.membershipId, input.roleId)) return;
    await this.store.assignRole(actor.orgId, input.membershipId, input.roleId);
  }
}
