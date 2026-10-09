import { ConflictError } from '../common/errors.js';
import { uuidv7 } from '../common/uuid.js';
import type { UserStatus } from '../identity/identity.store.js';
import { PlatformAccessRefusedError } from '../platform/errors.js';
import { SUPER_ADMIN_ROLE_KEY } from '../platform/platform-roles.js';
import { DEFAULT_ORGANISATION_ROLE_NAMES, ORGANISATION_ADMINISTRATOR_ROLE_NAME } from '../rbac/default-roles.js';
import { parseNewOrganisation, type NewOrganisationSettings } from './new-organisation.js';
import type { OrganisationStore } from './organisation.store.js';

export interface PlatformActorRef {
  userId: string;
  impersonating: boolean;
}

export interface CreatedOrganisation extends NewOrganisationSettings {
  id: string;
  initialAdministrator: {
    userId: string;
    email: string;
    /** 'invited' until they accept their invitation; until then the organisation has no active administrator. */
    status: UserStatus;
  };
}

export class OrganisationService {
  constructor(
    private readonly store: OrganisationStore,
    private readonly newId: () => string = uuidv7,
  ) {}

  /**
   * Authorisation is checked before the input, so a caller who may not create organisations learns
   * nothing from validation. The organisation, its default roles and its administrator's membership
   * are written in one transaction: any refusal leaves nothing behind.
   */
  async create(actor: PlatformActorRef, input: unknown): Promise<CreatedOrganisation> {
    await this.assertCanCreateOrganisations(actor);
    const { initialAdministratorEmail: email, ...settings } = parseNewOrganisation(input);
    const orgId = this.newId();

    return this.store.runInNewOrganisation(orgId, async (tx) => {
      if (!(await tx.insertOrganisation(settings))) {
        throw new ConflictError('ORGANISATION_NAME_TAKEN', `An organisation called '${settings.name}' already exists`);
      }

      const existing = await tx.findUserByEmail(email);
      if (existing?.holdsPlatformRole) {
        throw new ConflictError(
          'INITIAL_ADMIN_IS_PLATFORM_ACCOUNT',
          'That email belongs to a platform administrator, who cannot also belong to an organisation',
        );
      }
      const admin = existing ?? (await tx.createInvitedUser(email));

      const roles = await tx.createRoles(DEFAULT_ORGANISATION_ROLE_NAMES);
      const adminRole = roles.find((role) => role.name === ORGANISATION_ADMINISTRATOR_ROLE_NAME);
      if (!adminRole) throw new Error('The default roles do not include the organisation administrator role');

      const membershipId = await tx.insertMembership(admin.id);
      if (!membershipId) {
        throw new ConflictError(
          'INITIAL_ADMIN_IN_ANOTHER_ORGANISATION',
          'This person already belongs to an organisation and must be migrated instead of being added as the administrator of a new one',
        );
      }
      await tx.assignRole(membershipId, adminRole.id);

      return { id: orgId, ...settings, initialAdministrator: { userId: admin.id, email, status: admin.status } };
    });
  }

  private async assertCanCreateOrganisations(actor: PlatformActorRef): Promise<void> {
    if (actor.impersonating) {
      throw new PlatformAccessRefusedError('Organisations cannot be created while impersonating');
    }
    // Read from the database on every call: platform roles are not cached in the session.
    if (!(await this.store.platformRoleKeysOf(actor.userId)).includes(SUPER_ADMIN_ROLE_KEY)) {
      throw new PlatformAccessRefusedError('Only a super administrator can create organisations');
    }
  }
}
