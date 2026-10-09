import type { Prisma, PrismaClient } from '@cms/db';
import type { AuditEntry } from '../audit/audit-entry.js';
import { NotFoundError } from '../common/errors.js';
import { isUuid } from '../common/uuid.js';
import { isPermissionAction, type Permission } from '../rbac/permissions.js';
import type { OrganisationSettings, OrganisationSettingsChanges } from './organisation-settings.js';
import type { OrganisationSettingsStore, OrganisationSettingsTx, SettingsUpdateResult } from './organisation-settings.store.js';

const SETTINGS_FIELDS = {
  id: true,
  version: true,
  name: true,
  description: true,
  country: true,
  defaultCurrency: true,
  timeZone: true,
  contactEmail: true,
  contactPhone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  postalCode: true,
} as const;

/**
 * `prisma` is the platform client: each transaction sets its own tenant context, so RLS limits every
 * read and write to the caller's organisation. Moves onto the request-scoped TenantPrisma when it exists.
 */
export class PrismaOrganisationSettingsStore implements OrganisationSettingsStore {
  constructor(private readonly prisma: PrismaClient) {}

  runInOrganisation<T>(orgId: string, work: (tx: OrganisationSettingsTx) => Promise<T>): Promise<T> {
    if (!isUuid(orgId)) return Promise.reject(new NotFoundError('ORGANISATION_NOT_FOUND', 'Organisation not found'));
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
      return work(new PrismaOrganisationSettingsTx(tx, orgId));
    });
  }
}

class PrismaOrganisationSettingsTx implements OrganisationSettingsTx {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly orgId: string,
  ) {}

  async permissionsOf(userId: string): Promise<Permission[]> {
    if (!isUuid(userId)) return [];
    const grants = await this.tx.rolePermission.findMany({
      where: {
        orgId: this.orgId,
        role: { memberships: { some: { membership: { orgId: this.orgId, userId, user: { status: 'active' } } } } },
      },
      select: { area: true, action: true },
      distinct: ['area', 'action'],
    });
    return grants.filter((grant): grant is Permission => isPermissionAction(grant.action));
  }

  findSettings(): Promise<OrganisationSettings | null> {
    return this.tx.organisation.findUnique({ where: { id: this.orgId }, select: SETTINGS_FIELDS });
  }

  async updateSettings(expectedVersion: number, changes: OrganisationSettingsChanges): Promise<SettingsUpdateResult> {
    try {
      // The version condition makes a concurrent save that committed first win: this one matches no row.
      const { count } = await this.tx.organisation.updateMany({
        where: { id: this.orgId, version: expectedVersion },
        data: { ...changes, version: { increment: 1 } },
      });
      if (count === 0) return { ok: false, reason: 'STALE' };
    } catch (error) {
      // The case-insensitive name index also sees organisations RLS hides from this transaction.
      if (isUniqueViolation(error)) return { ok: false, reason: 'NAME_TAKEN' };
      throw error;
    }
    const settings = await this.tx.organisation.findUniqueOrThrow({ where: { id: this.orgId }, select: SETTINGS_FIELDS });
    return { ok: true, settings };
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        orgId: this.orgId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
        at: entry.at,
      },
    });
  }
}

/** Prisma reports a unique violation as P2002; checked by shape so this module needs no runtime import of @cms/db. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
