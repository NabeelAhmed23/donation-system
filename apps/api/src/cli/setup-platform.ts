import { readFileSync } from 'node:fs';
import { createPlatformPrismaClient } from '@cms/db';
import { consoleJsonLogger, describeError } from '../common/logger.js';
import { Argon2PasswordHasher } from '../identity/argon2-password-hasher.js';
import { BootstrapConfigError, readSuperAdminCredentials } from '../platform/bootstrap-credentials.js';
import { PrismaPlatformStore } from '../platform/prisma-platform.store.js';
import { setupPlatform } from '../platform/setup-platform.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new BootstrapConfigError('DATABASE_URL is not set');

  const prisma = createPlatformPrismaClient(databaseUrl);
  try {
    await setupPlatform(
      { store: new PrismaPlatformStore(prisma), hasher: new Argon2PasswordHasher(), logger: consoleJsonLogger },
      () => readSuperAdminCredentials(process.env, (path) => readFileSync(path, 'utf8')),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  consoleJsonLogger.error('Platform setup failed', describeError(error));
  process.exitCode = 1;
});
