import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export { Prisma, PrismaClient } from './generated/prisma/client.js';

/**
 * Creates a client with no tenant context. Only platform-level code (the setup and recovery
 * commands, identity lookups on the global users table) may use it; organisation data must be
 * read through the tenant-scoped client so RLS applies.
 */
export function createPlatformPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
