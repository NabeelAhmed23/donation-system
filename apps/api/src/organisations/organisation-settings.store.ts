import type { AuditEntry } from '../audit/audit-entry.js';
import type { Permission } from '../rbac/permissions.js';
import type { OrganisationSettings, OrganisationSettingsChanges } from './organisation-settings.js';

export type SettingsUpdateResult =
  | { ok: true; settings: OrganisationSettings }
  | { ok: false; reason: 'STALE' | 'NAME_TAKEN' };

/** Reads and writes inside one organisation's tenant context. */
export interface OrganisationSettingsTx {
  /** Effective permissions of `userId` here: empty unless they are an active member of this organisation. */
  permissionsOf(userId: string): Promise<Permission[]>;
  findSettings(): Promise<OrganisationSettings | null>;
  /**
   * Applies `changes` only while the stored version still equals `expectedVersion`, and increments it.
   * After NAME_TAKEN the transaction may be unusable: the caller must abandon it.
   */
  updateSettings(expectedVersion: number, changes: OrganisationSettingsChanges): Promise<SettingsUpdateResult>;
  appendAudit(entry: AuditEntry): Promise<void>;
}

export interface OrganisationSettingsStore {
  /** Runs `work` in one transaction with `orgId` as the tenant context. Nothing is kept if it throws. */
  runInOrganisation<T>(orgId: string, work: (tx: OrganisationSettingsTx) => Promise<T>): Promise<T>;
}
