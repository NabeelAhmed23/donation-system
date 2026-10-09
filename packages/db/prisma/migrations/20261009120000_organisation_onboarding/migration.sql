-- AlterEnum
ALTER TYPE "user_status" ADD VALUE 'invited';

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- AlterTable
-- No organisation can exist before this story (nothing could create one), so the columns need no default.
ALTER TABLE "organisations" ADD COLUMN "country" TEXT NOT NULL,
ADD COLUMN "default_currency" TEXT NOT NULL,
ADD COLUMN "time_zone" TEXT NOT NULL;

-- ---------------------------------------------------------------------------
-- Hand-written: constraints Prisma cannot express in schema.prisma.
-- ---------------------------------------------------------------------------

-- Only a user who has not accepted their invitation may be without a password. The enum is compared
-- as text because the value added above cannot be used as an enum literal in the same transaction.
ALTER TABLE "users" ADD CONSTRAINT "users_password_required_check"
    CHECK ("status"::text = 'invited' OR "password_hash" IS NOT NULL);

ALTER TABLE "organisations" ADD CONSTRAINT "organisations_name_check" CHECK ("name" = btrim("name") AND "name" <> '');
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_country_check" CHECK ("country" ~ '^[A-Z]{2}$');
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_default_currency_check" CHECK ("default_currency" ~ '^[A-Z]{3}$');
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_time_zone_check" CHECK ("time_zone" <> '');

-- Organisation names are unique across the platform, ignoring case. A unique index is enforced
-- regardless of RLS, so a creation running in the new organisation's tenant context still detects a
-- name taken by an organisation it cannot see (INSERT … ON CONFLICT DO NOTHING), including one being
-- created at the same moment by another super administrator.
CREATE UNIQUE INDEX "organisations_name_lower_key" ON "organisations" (lower("name"));
