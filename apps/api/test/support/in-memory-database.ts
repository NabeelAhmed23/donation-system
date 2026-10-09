import { randomUUID } from 'node:crypto';
import type { LogFields, Logger } from '../../src/common/logger.js';
import type { IdentityStore, IdentityUser, PasswordUpdate } from '../../src/identity/identity.store.js';
import type { PasswordHasher } from '../../src/identity/password-hasher.js';
import type { PlatformStore, PlatformTx } from '../../src/platform/platform.store.js';
import type { RoleAssignmentStore } from '../../src/rbac/role-assignment.store.js';

export interface StoredUser extends IdentityUser {
  passwordChangedAt: Date | null;
}

/** In-memory stand-in for PostgreSQL. runExclusive serialises work like the advisory lock does. */
export class InMemoryDatabase implements PlatformStore, IdentityStore, RoleAssignmentStore {
  readonly users = new Map<string, StoredUser>();
  readonly platformRoles: { id: string; key: string; name: string }[] = [];
  readonly platformRoleGrants: { userId: string; platformRoleId: string; grantedByUserId: string | null }[] = [];
  readonly memberships: { id: string; orgId: string; userId: string }[] = [];
  readonly roles: { id: string; orgId: string; name: string }[] = [];
  readonly membershipRoles: { orgId: string; membershipId: string; roleId: string }[] = [];
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

  private findByEmail(email: string): StoredUser | undefined {
    return [...this.users.values()].find((u) => u.email === email);
  }
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
