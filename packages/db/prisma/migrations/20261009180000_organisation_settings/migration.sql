-- US-2: organisation profile and core settings, per-role permissions, and the append-only audit log.

-- AlterTable
ALTER TABLE "organisations" ADD COLUMN     "address_line1" TEXT,
ADD COLUMN     "address_line2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "role_permissions" (
    "org_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "area" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","area","action")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ts" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_permissions_org_id_idx" ON "role_permissions"("org_id");

-- CreateIndex
CREATE INDEX "audit_log_org_id_ts_idx" ON "audit_log"("org_id", "ts");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_org_id_role_id_fkey" FOREIGN KEY ("org_id", "role_id") REFERENCES "roles"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Hand-written below: Prisma cannot express CHECK constraints, RLS, triggers or grants.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "organisations" ADD CONSTRAINT "organisations_version_check" CHECK ("version" > 0);
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_contact_email_lower_check" CHECK ("contact_email" = lower("contact_email"));

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_action_check"
  CHECK ("action" IN ('view', 'create', 'edit', 'delete', 'approve', 'manage'));
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_area_check" CHECK ("area" ~ '^[a-z][a-z0-9-]*$');

-- Existing organisations' administrators get the organisation-settings permissions that new
-- organisations are seeded with. Runs before RLS is enabled on role_permissions.
INSERT INTO "role_permissions" ("org_id", "role_id", "area", "action")
SELECT r."org_id", r."id", p."area", p."action"
FROM "roles" r
CROSS JOIN (VALUES ('organisation-settings', 'view'), ('organisation-settings', 'edit')) AS p("area", "action")
WHERE r."name" = 'Organisation Administrator'
ON CONFLICT DO NOTHING;

-- Tenant isolation: fails closed when app.org_id is unset.
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "role_permissions_tenant_isolation" ON "role_permissions"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid);

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- The audit log is append-only, whoever connects.
CREATE FUNCTION "audit_log_refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_log_append_only" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_refuse_change"();

-- The application role may read and append audit entries but never change them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_app') THEN
    GRANT SELECT, INSERT ON "audit_log" TO cms_app;
    GRANT SELECT, INSERT, DELETE ON "role_permissions" TO cms_app;
  END IF;
END;
$$;
