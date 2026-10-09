-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'suspended', 'deactivated');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "password_changed_at" TIMESTAMPTZ(3),
    "status" "user_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_roles" (
    "org_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membership_id","role_id")
);

-- CreateTable
CREATE TABLE "platform_roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_platform_roles" (
    "user_id" UUID NOT NULL,
    "platform_role_id" UUID NOT NULL,
    "granted_by_user_id" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_platform_roles_pkey" PRIMARY KEY ("user_id","platform_role_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_key" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_org_id_id_key" ON "memberships"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_org_id_id_key" ON "roles"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_org_id_name_key" ON "roles"("org_id", "name");

-- CreateIndex
CREATE INDEX "membership_roles_org_id_role_id_idx" ON "membership_roles"("org_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_roles_key_key" ON "platform_roles"("key");

-- CreateIndex
CREATE INDEX "user_platform_roles_platform_role_id_idx" ON "user_platform_roles"("platform_role_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_org_id_membership_id_fkey" FOREIGN KEY ("org_id", "membership_id") REFERENCES "memberships"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_org_id_role_id_fkey" FOREIGN KEY ("org_id", "role_id") REFERENCES "roles"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_platform_roles" ADD CONSTRAINT "user_platform_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_platform_roles" ADD CONSTRAINT "user_platform_roles_platform_role_id_fkey" FOREIGN KEY ("platform_role_id") REFERENCES "platform_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: constraints Prisma cannot express in schema.prisma.
-- ---------------------------------------------------------------------------

-- Emails are normalised to lower case by the application; the database refuses anything else.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));

-- Tenant isolation. Policies fail closed: with app.org_id unset no rows match.
-- Platform-level read and write policies (US-1, US-7) arrive with those stories.
ALTER TABLE "organisations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organisations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "organisations_tenant_isolation" ON "organisations"
    USING ("id" = NULLIF(current_setting('app.org_id', true), '')::uuid)
    WITH CHECK ("id" = NULLIF(current_setting('app.org_id', true), '')::uuid);

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "memberships_tenant_isolation" ON "memberships"
    USING ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid);

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "roles_tenant_isolation" ON "roles"
    USING ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid);

ALTER TABLE "membership_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "membership_roles_tenant_isolation" ON "membership_roles"
    USING ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid);
