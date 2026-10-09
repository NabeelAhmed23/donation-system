import { ConflictError } from '../common/errors.js';
import type { Logger } from '../common/logger.js';
import type { PasswordHasher } from '../identity/password-hasher.js';
import type { SuperAdminCredentials } from './bootstrap-credentials.js';
import type { PlatformStore } from './platform.store.js';
import { SUPER_ADMIN_ROLE_KEY, SUPER_ADMIN_ROLE_NAME } from './platform-roles.js';

export interface PlatformSetupDeps {
  store: PlatformStore;
  hasher: PasswordHasher;
  logger: Logger;
}

export interface PlatformSetupResult {
  roleCreated: boolean;
  accountCreated: boolean;
}

/**
 * Credentials are loaded only when an account has to be created, so later runs work after the
 * operator removes them from the deployment configuration. An existing account is never modified.
 */
export async function setupPlatform(
  deps: PlatformSetupDeps,
  loadCredentials: () => SuperAdminCredentials,
): Promise<PlatformSetupResult> {
  const outcome = await deps.store.runExclusive(async (tx) => {
    let role = await tx.findPlatformRoleByKey(SUPER_ADMIN_ROLE_KEY);
    const roleCreated = role === null;
    role ??= await tx.createPlatformRole({ key: SUPER_ADMIN_ROLE_KEY, name: SUPER_ADMIN_ROLE_NAME });

    if ((await tx.countRoleHolders(role.id)) > 0) {
      return { roleCreated, accountCreated: false, userId: null };
    }

    const credentials = loadCredentials();
    if (await tx.findUserIdByEmail(credentials.email)) {
      throw new ConflictError(
        'SUPER_ADMIN_EMAIL_IN_USE',
        'SUPER_ADMIN_EMAIL belongs to an existing account; refusing to promote it automatically',
      );
    }

    const user = await tx.createUser({
      email: credentials.email,
      passwordHash: await deps.hasher.hash(credentials.password),
      mustChangePassword: true,
    });
    await tx.grantPlatformRole({ userId: user.id, roleId: role.id, grantedByUserId: null });
    return { roleCreated, accountCreated: true, userId: user.id };
  });

  deps.logger.info(
    outcome.roleCreated ? 'Super administrator role created' : 'Super administrator role already exists',
  );
  if (outcome.accountCreated) {
    deps.logger.info('Initial super administrator account created; the password must be changed at first sign-in', {
      userId: outcome.userId,
    });
  } else {
    deps.logger.info('A super administrator account already exists; no account created');
  }

  return { roleCreated: outcome.roleCreated, accountCreated: outcome.accountCreated };
}
