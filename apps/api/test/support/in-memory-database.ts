import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '../../src/audit/audit-entry.js';
import type { LogFields, Logger } from '../../src/common/logger.js';
import type { IdentityStore, IdentityUser, PasswordUpdate } from '../../src/identity/identity.store.js';
import type { PasswordHasher } from '../../src/identity/password-hasher.js';
import type { NewOrganisationSettings } from '../../src/organisations/new-organisation.js';
import type { OrganisationDetails, OrganisationSettings } from '../../src/organisations/organisation-settings.js';
import type { OrganisationSettingsStore, OrganisationSettingsTx } from '../../src/organisations/organisation-settings.store.js';
import type { NewOrganisationTx, OrganisationStore } from '../../src/organisations/organisation.store.js';
import type { PlatformStore, PlatformTx } from '../../src/platform/platform.store.js';
import type { PermissionAction } from '../../src/rbac/permissions.js';
import type { RoleAssignmentStore } from '../../src/rbac/role-assignment.store.js';

export interface StoredUser extends IdentityUser {
  passwordChangedAt: Date | null;
}

/** Details and version are absent until the settings are first changed (the columns' defaults). */
export interface StoredOrganisation extends NewOrganisationSettings, Partial<OrganisationDetails> {
  id: string;
  version?: number;
}

export interface StoredRolePermission {
  orgId: string;
  roleId: string;
  area: string;
  action: PermissionAction;
}

export type StoredAuditEntry = AuditEntry & { orgId: string };

interface Snapshot {
  users: Map<string, StoredUser>;
  organisations: StoredOrganisation[];
  memberships: { id: string; orgId: string; userId: string }[];
  roles: { id: string; orgId: string; name: string }[];
  membershipRoles: { orgId: string; membershipId: string; roleId: string }[];
  rolePermissions: StoredRolePermission[];
  auditLog: StoredAuditEntry[];
}

/**
 * In-memory stand-in for PostgreSQL. runExclusive, runInNewOrganisation and runInOrganisation serialise
 * work like the advisory locks and row locks do; the organisation transactions also roll back when their
 * work throws.
 */
export class InMemoryDatabase
  implements PlatformStore, IdentityStore, RoleAssignmentStore, OrganisationStore, OrganisationSettingsStore
{
  readonly users = new Map<string, StoredUser>();
  readonly organisations: StoredOrganisation[] = [];
  readonly platformRoles: { id: string; key: string; name: string }[] = [];
  readonly platformRoleGrants: { userId: string; platformRoleId: string; grantedByUserId: string | null }[] = [];
  readonly memberships: { id: string; orgId: string; userId: string }[] = [];
  readonly roles: { id: string; orgId: string; name: string }[] = [];
  readonly membershipRoles: { orgId: string; membershipId: string; roleId: string }[] = [];
  readonly rolePermissions: StoredRolePermission[] = [];
  readonly auditLog: StoredAuditEntry[] = [];
  private exclusive: Promise<unknown> = Promise.resolve();

  runExclusive<T>(work: (tx: PlatformTx) => Promise<T>): Promise<T> {
    const run = this.exclusive.then(() => work(this.platformTx));
    this.exclusive = run.catch(() => undefined);
    return run;
  }

  private readonly platformTx: PlatformTx = {
    findPlatformRoleByKey: async (key) => {
      const role = this.platformRoles.find((r) => r.key === key);
      return role ? { id: role.id, key: role.key } : null;
    },
    createPlatformRole: async ({ key, name }) => {
      if (this.platformRoles.some((r) => r.key === key)) throw new Error('unique violation: platform_roles.key');
      const role = { id: randomUUID(), key, name };
      this.platformRoles.push(role);
      return { id: role.id, key: role.key };
    },
    countRoleHolders: async (roleId) => this.platformRoleGrants.filter((g) => g.platformRoleId === roleId).length,
    findUserIdByEmail: async (email) => this.findByEmail(email)?.id ?? null,
    userExists: async (userId) => this.users.has(userId),
    createUser: async (user) => {
      if (this.findByEmail(user.email)) throw new Error('unique violation: users.email');
      const id = randomUUID();
      this.users.set(id, { id, status: 'active', passwordChangedAt: null, ...user });
      return { id };
    },
    hasPlatformRole: async (userId, roleId) =>
      this.platformRoleGrants.some((g) => g.userId === userId && g.platformRoleId === roleId),
    grantPlatformRole: async ({ userId, roleId, grantedByUserId }) => {
      this.platformRoleGrants.push({ userId, platformRoleId: roleId, grantedByUserId });
    },
    revokePlatformRole: async (userId, roleId) => {
      const index = this.platformRoleGrants.findIndex((g) => g.userId === userId && g.platformRoleId === roleId);
      this.platformRoleGrants.splice(index, 1);
    },
    findRoleHolderIdByEmail: async (roleId, email) => {
      const user = this.findByEmail(email);
      return user && this.platformRoleGrants.some((g) => g.userId === user.id && g.platformRoleId === roleId) ? user.id : null;
    },
    resetCredentials: async (userId, reset) => {
      const user = this.users.get(userId);
      if (!user) throw new Error('record not found');
      Object.assign(user, reset);
    },
  };

  // OrganisationStore
  async platformRoleKeysOf(userId: string): Promise<string[]> {
    if (this.users.get(userId)?.status !== 'active') return [];
    return this.platformRoleGrants
      .filter((g) => g.userId === userId)
      .flatMap((g) => this.platformRoles.filter((r) => r.id === g.platformRoleId).map((r) => r.key));
  }

  runInNewOrganisation<T>(orgId: string, work: (tx: NewOrganisationTx) => Promise<T>): Promise<T> {
    return this.atomically(() => work(this.newOrganisationTx(orgId)));
  }

  private newOrganisationTx(orgId: string): NewOrganisationTx {
    return {
      insertOrganisation: async (settings) => {
        const name = settings.name.toLowerCase();
        if (this.organisations.some((o) => o.name.toLowerCase() === name)) return false;
        this.organisations.push({ id: orgId, ...settings });
        return true;
      },
      findUserByEmail: async (email) => {
        const user = this.findByEmail(email);
        if (!user) return null;
        return { id: user.id, status: user.status, holdsPlatformRole: this.platformRoleGrants.some((g) => g.userId === user.id) };
      },
      createInvitedUser: async (email) => {
        if (this.findByEmail(email)) throw new Error('unique violation: users.email');
        const id = randomUUID();
        this.users.set(id, { id, email, passwordHash: null, mustChangePassword: true, status: 'invited', passwordChangedAt: null });
        return { id, status: 'invited' };
      },
      createRoles: async (names) => names.map((name) => ({ id: this.addOrganisationRole(orgId, name), name })),
      grantPermissions: async (roleId, permissions) => {
        permissions.forEach(({ area, action }) => this.rolePermissions.push({ orgId, roleId, area, action }));
      },
      insertMembership: async (userId) => {
        if (this.memberships.some((m) => m.userId === userId)) return null;
        const id = randomUUID();
        this.memberships.push({ id, orgId, userId });
        return id;
      },
      assignRole: async (membershipId, roleId) => {
        this.membershipRoles.push({ orgId, membershipId, roleId });
      },
    };
  }

  // OrganisationSettingsStore
  runInOrganisation<T>(orgId: string, work: (tx: OrganisationSettingsTx) => Promise<T>): Promise<T> {
    return this.atomically(() => work(this.organisationSettingsTx(orgId)));
  }

  private organisationSettingsTx(orgId: string): OrganisationSettingsTx {
    return {
      permissionsOf: async (userId) => {
        if (this.users.get(userId)?.status !== 'active') return [];
        const membership = this.memberships.find((m) => m.orgId === orgId && m.userId === userId);
        if (!membership) return [];
        const roleIds = this.membershipRoles
          .filter((mr) => mr.orgId === orgId && mr.membershipId === membership.id)
          .map((mr) => mr.roleId);
        return this.rolePermissions
          .filter((p) => p.orgId === orgId && roleIds.includes(p.roleId))
          .map(({ area, action }) => ({ area, action }));
      },
      findSettings: async () => {
        const organisation = this.organisations.find((o) => o.id === orgId);
        return organisation ? settingsOf(organisation) : null;
      },
      updateSettings: async (expectedVersion, changes) => {
        const index = this.organisations.findIndex((o) => o.id === orgId);
        if (index === -1 || settingsOf(this.organisations[index]).version !== expectedVersion) {
          return { ok: false, reason: 'STALE' };
        }
        const name = changes.name?.toLowerCase();
        if (name !== undefined && this.organisations.some((o) => o.id !== orgId && o.name.toLowerCase() === name)) {
          return { ok: false, reason: 'NAME_TAKEN' };
        }
        // Replaced rather than mutated, so a rollback restores the previous object.
        const updated = { ...this.organisations[index], ...changes, version: expectedVersion + 1 };
        this.organisations[index] = updated;
        return { ok: true, settings: settingsOf(updated) };
      },
      appendAudit: async (entry) => {
        this.auditLog.push({ orgId, ...entry });
      },
    };
  }

  // IdentityStore
  async findUserByEmail(email: string): Promise<IdentityUser | null> {
    return this.findByEmail(email) ?? null;
  }

  async findUserById(userId: string): Promise<IdentityUser | null> {
    return this.users.get(userId) ?? null;
  }

  async updatePassword(userId: string, update: PasswordUpdate): Promise<void> {
    const user = this.users.get(userId);
    if (!user) throw new Error('record not found');
    Object.assign(user, update);
  }

  // RoleAssignmentStore
  async isPlatformRole(roleRef: string): Promise<boolean> {
    return this.platformRoles.some((r) => r.id === roleRef || r.key === roleRef);
  }

  async findMembership(orgId: string, membershipId: string): Promise<{ id: string } | null> {
    const membership = this.memberships.find((m) => m.orgId === orgId && m.id === membershipId);
    return membership ? { id: membership.id } : null;
  }

  async findRole(orgId: string, roleId: string): Promise<{ id: string } | null> {
    const role = this.roles.find((r) => r.orgId === orgId && r.id === roleId);
    return role ? { id: role.id } : null;
  }

  async hasRole(orgId: string, membershipId: string, roleId: string): Promise<boolean> {
    return this.membershipRoles.some((mr) => mr.orgId === orgId && mr.membershipId === membershipId && mr.roleId === roleId);
  }

  async assignRole(orgId: string, membershipId: string, roleId: string): Promise<void> {
    this.membershipRoles.push({ orgId, membershipId, roleId });
  }

  // Helpers for arranging and asserting state
  holderIdsOf(roleKey: string): string[] {
    const role = this.platformRoles.find((r) => r.key === roleKey);
    return role ? this.platformRoleGrants.filter((g) => g.platformRoleId === role.id).map((g) => g.userId) : [];
  }

  addUser(email: string, passwordHash = 'unused'): string {
    const id = randomUUID();
    this.users.set(id, { id, email, passwordHash, mustChangePassword: false, status: 'active', passwordChangedAt: null });
    return id;
  }

  addOrganisationMember(orgId: string, email: string): string {
    const id = randomUUID();
    this.memberships.push({ id, orgId, userId: this.addUser(email) });
    return id;
  }

  addOrganisationRole(orgId: string, name: string): string {
    const id = randomUUID();
    this.roles.push({ id, orgId, name });
    return id;
  }

  private atomically<T>(work: () => Promise<T>): Promise<T> {
    const run = this.exclusive.then(async () => {
      const snapshot = this.snapshot();
      try {
        return await work();
      } catch (error) {
        this.restore(snapshot);
        throw error;
      }
    });
    this.exclusive = run.catch(() => undefined);
    return run;
  }

  private findByEmail(email: string): StoredUser | undefined {
    return [...this.users.values()].find((u) => u.email === email);
  }

  private snapshot(): Snapshot {
    return {
      users: new Map(this.users),
      organisations: [...this.organisations],
      memberships: [...this.memberships],
      roles: [...this.roles],
      membershipRoles: [...this.membershipRoles],
      rolePermissions: [...this.rolePermissions],
      auditLog: [...this.auditLog],
    };
  }

  private restore(snapshot: Snapshot): void {
    this.users.clear();
    snapshot.users.forEach((user, id) => this.users.set(id, user));
    this.organisations.splice(0, this.organisations.length, ...snapshot.organisations);
    this.memberships.splice(0, this.memberships.length, ...snapshot.memberships);
    this.roles.splice(0, this.roles.length, ...snapshot.roles);
    this.membershipRoles.splice(0, this.membershipRoles.length, ...snapshot.membershipRoles);
    this.rolePermissions.splice(0, this.rolePermissions.length, ...snapshot.rolePermissions);
    this.auditLog.splice(0, this.auditLog.length, ...snapshot.auditLog);
  }
}

function settingsOf(organisation: StoredOrganisation): OrganisationSettings {
  return {
    id: organisation.id,
    version: organisation.version ?? 1,
    name: organisation.name,
    description: organisation.description ?? null,
    country: organisation.country,
    defaultCurrency: organisation.defaultCurrency,
    timeZone: organisation.timeZone,
    contactEmail: organisation.contactEmail ?? null,
    contactPhone: organisation.contactPhone ?? null,
    addressLine1: organisation.addressLine1 ?? null,
    addressLine2: organisation.addressLine2 ?? null,
    city: organisation.city ?? null,
    region: organisation.region ?? null,
    postalCode: organisation.postalCode ?? null,
  };
}

export class FakeHasher implements PasswordHasher {
  verifyCalls = 0;

  async hash(password: string): Promise<string> {
    return `fake-hash(${password})`;
  }

  async verify(hash: string, password: string): Promise<boolean> {
    this.verifyCalls += 1;
    return hash === `fake-hash(${password})`;
  }
}

export class RecordingLogger implements Logger {
  readonly entries: { level: string; message: string; fields?: LogFields }[] = [];

  info(message: string, fields?: LogFields): void {
    this.entries.push({ level: 'info', message, fields });
  }

  warn(message: string, fields?: LogFields): void {
    this.entries.push({ level: 'warn', message, fields });
  }

  error(message: string, fields?: LogFields): void {
    this.entries.push({ level: 'error', message, fields });
  }

  text(): string {
    return JSON.stringify(this.entries);
  }
}
