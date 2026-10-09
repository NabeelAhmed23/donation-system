import { NotFoundError } from '../common/errors.js';
import type { Logger } from '../common/logger.js';
import type { PasswordHasher } from '../identity/password-hasher.js';
import type { SuperAdminCredentials } from './bootstrap-credentials.js';
import type { PlatformStore } from './platform.store.js';
import { SUPER_ADMIN_ROLE_KEY } from './platform-roles.js';

export interface RecoverSuperAdminDeps {
  store: PlatformStore;
  hasher: PasswordHasher;
  logger: Logger;
}

export async function recoverSuperAdmin(
  deps: RecoverSuperAdminDeps,
  credentials: SuperAdminCredentials,
): Promise<{ userId: string }> {
  const userId = await deps.store.runExclusive(async (tx) => {
    const role = await tx.findPlatformRoleByKey(SUPER_ADMIN_ROLE_KEY);
    if (!role) throw new NotFoundError('PLATFORM_NOT_SET_UP', 'The super administrator role does not exist; run setup first');

    const holderId = await tx.findRoleHolderIdByEmail(role.id, credentials.email);
    if (!holderId) throw new NotFoundError('SUPER_ADMIN_NOT_FOUND', 'No super administrator account has that email address');

    await tx.resetCredentials(holderId, {
      passwordHash: await deps.hasher.hash(credentials.password),
      mustChangePassword: true,
      status: 'active',
    });
    return holderId;
  });

  deps.logger.warn(
    'Super administrator credentials reset by break-glass recovery; the password must be changed at next sign-in',
    { userId },
  );
  return { userId };
}
