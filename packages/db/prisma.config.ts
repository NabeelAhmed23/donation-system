import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // `prisma generate` does not connect, so an unset URL only fails commands that need the database.
    url: process.env.DATABASE_URL ?? '',
  },
});
