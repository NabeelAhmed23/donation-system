import { readFileSync } from 'node:fs';
import { createPlatformPrismaClient } from '@cms/db';
import { consoleJsonLogger, describeError } from '../common/logger.js';
import { Argon2PasswordHasher } from '../identity/argon2-password-hasher.js';
import { BootstrapConfigError, readSuperAdminCredentials } from '../platform/bootstrap-credentials.js';
import { PrismaPlatformStore } from '../platform/prisma-platform.store.js';
import { recoverSuperAdmin } from '../platform/recover-super-admin.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new BootstrapConfigError('DATABASE_URL is not set');

  const credentials = readSuperAdminCredentials(process.env, (path) => readFileSync(path, 'utf8'));
  const prisma = createPlatformPrismaClient(databaseUrl);
  try {
    await recoverSuperAdmin(
      { store: new PrismaPlatformStore(prisma), hasher: new Argon2PasswordHasher(), logger: consoleJsonLogger },
      credentials,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  consoleJsonLogger.error('Super administrator recovery failed', describeError(error));
  process.exitCode = 1;
});
