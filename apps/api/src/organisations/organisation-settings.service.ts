import type { AuditValue } from '../audit/audit-entry.js';
import { ConflictError, ForbiddenError, NotFoundError, PreconditionRequiredError } from '../common/errors.js';
import {
  hasPermission,
  ORGANISATION_SETTINGS_AREA,
  PermissionDeniedError,
  type PermissionAction,
} from '../rbac/permissions.js';
import {
  ORGANISATION_PROFILE_FIELDS,
  parseOrganisationSettingsChanges,
  type OrganisationSettings,
  type OrganisationSettingsChanges,
} from './organisation-settings.js';
import type { OrganisationSettingsStore, OrganisationSettingsTx } from './organisation-settings.store.js';

export const ORGANISATION_SETTINGS_UPDATED = 'organisation.settings.updated';

export interface OrganisationActorRef {
  userId: string;
  /** From the session, never from the request. */
  orgId: string;
  impersonating: boolean;
}

export class OrganisationSettingsService {
  constructor(
    private readonly store: OrganisationSettingsStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  get(actor: OrganisationActorRef): Promise<OrganisationSettings> {
    return this.store.runInOrganisation(actor.orgId, async (tx) => {
      await assertPermitted(tx, actor.userId, 'view');
      return requireSettings(await tx.findSettings());
    });
  }

  /**
   * Permission is checked before the version and the input, so a caller who may not edit learns nothing
   * from either. Only fields whose value actually changes are written and audited; the change and its
   * audit entry commit together or not at all. Recorded donations are never touched.
   */
  async update(
    actor: OrganisationActorRef,
    expectedVersion: number | undefined,
    input: unknown,
  ): Promise<OrganisationSettings> {
    if (actor.impersonating) {
      // The session does not carry the original actor yet, so the audit entry could not name them (REQ-047).
      throw new ForbiddenError('IMPERSONATION_RESTRICTED', 'Organisation settings cannot be changed while impersonating');
    }

    return this.store.runInOrganisation(actor.orgId, async (tx) => {
      await assertPermitted(tx, actor.userId, 'edit');
      if (expectedVersion === undefined) {
        throw new PreconditionRequiredError(
          'IF_MATCH_REQUIRED',
          'Send the version of the settings you are changing in the If-Match header, e.g. "3"',
        );
      }
      const requested = parseOrganisationSettingsChanges(input);
      const current = requireSettings(await tx.findSettings());
      if (current.version !== expectedVersion) throw staleVersion();

      const { changes, before, after } = diff(current, requested);
      if (Object.keys(changes).length === 0) return current;

      const result = await tx.updateSettings(expectedVersion, changes);
      if (!result.ok) {
        throw result.reason === 'NAME_TAKEN'
          ? new ConflictError('ORGANISATION_NAME_TAKEN', `An organisation called '${changes.name}' already exists`)
          : staleVersion();
      }

      await tx.appendAudit({
        actorUserId: actor.userId,
        action: ORGANISATION_SETTINGS_UPDATED,
        entity: 'organisation',
        entityId: actor.orgId,
        before,
        after,
        at: this.clock(),
      });
      return result.settings;
    });
  }
}

async function assertPermitted(tx: OrganisationSettingsTx, userId: string, action: PermissionAction): Promise<void> {
  // Read from the database on every call, so a revoked permission applies to the very next request.
  if (!hasPermission(await tx.permissionsOf(userId), ORGANISATION_SETTINGS_AREA, action)) {
    throw new PermissionDeniedError(
      action === 'view'
        ? 'You do not have permission to view the organisation settings'
        : 'You do not have permission to change the organisation settings',
    );
  }
}

function requireSettings(settings: OrganisationSettings | null): OrganisationSettings {
  if (!settings) throw new NotFoundError('ORGANISATION_NOT_FOUND', 'Organisation not found');
  return settings;
}

function staleVersion(): ConflictError {
  return new ConflictError(
    'STALE_VERSION',
    'Someone else changed the organisation settings after you loaded them. Load the latest settings and try again.',
  );
}

function diff(current: OrganisationSettings, requested: OrganisationSettingsChanges) {
  const changes: OrganisationSettingsChanges = {};
  const before: Record<string, AuditValue> = {};
  const after: Record<string, AuditValue> = {};
  for (const field of ORGANISATION_PROFILE_FIELDS) {
    const next = requested[field];
    if (next === undefined || next === current[field]) continue;
    Object.assign(changes, { [field]: next });
    before[field] = current[field];
    after[field] = next;
  }
  return { changes, before, after };
}
