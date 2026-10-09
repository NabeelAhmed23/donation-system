# Extension points for charity-specific features

| | |
|---|---|
| Story | US-67 — Extensible core for charity-specific features |
| Requirement | REQ-063 |
| Baseline | Default Architecture rev. 2 (NestJS modular monolith, Prisma 7, PostgreSQL 16 with RLS) |
| Status | Proposed — for review with the architecture baseline |

## 1. Purpose

Charities will need features that only some of them use, for example orphan sponsorship, zakat assessment,
qurbani orders or scholarship tracking. This document names the places where such features plug into the
platform (the **extension points**). It also shows that adding one leaves the core organisation, user,
donation, permission and financial workflows unchanged.

"Unchanged" has a precise meaning here. An extension may not:

- edit any file in a core module,
- edit the core Prisma schema files or core migrations,
- add a step inside a core transaction, or
- read or write core tables except through the contracts in section 2.2.

An extension uses the core only through the contracts described below. Section 7 lists how each rule is
enforced. Where a rule protects financial data, it is enforced at runtime and in the database, not only by
lint.

## 2. The core boundary

### 2.1 Core modules

The following NestJS modules in `apps/api/src/modules/` and their tables are **core**:

| Core workflow | Modules |
|---|---|
| Organisation | `organisations`, `platform`, `extensions` (registry and `organisation_extensions`) |
| User | `identity`, `users` (profiles), `relationships`, `impersonation` |
| Permission | `rbac` (roles, role_permissions, membership_roles, platform_roles) |
| Donation | `donation-types`, `donations` |
| Financial | `obligations`, `fx`, `receipts`, `reports` (core report set) |
| Cross-cutting | `audit`, `notifications`, the global guard pipeline, `TenantPrisma` |

The core SPA (`apps/web/src/**`) and the core worker (`apps/worker/src/**`) are also core.

An extension lives in one folder, `extensions/<extension-id>/`, with one sub-folder per runtime:

| Path | Runtime | Contents |
|---|---|---|
| `extensions/<id>/shared/` | any | `definition.ts`: the runtime-neutral `ExtensionDefinition` (section 3) |
| `extensions/<id>/api/` | API (Node) | NestJS module, controllers, services, report runners |
| `extensions/<id>/worker/` | worker (Node) | event subscribers |
| `extensions/<id>/web/` | SPA (browser) | routes, navigation entries, profile tabs |

Its database objects live in `packages/db/prisma/schema/ext-<id>.prisma`, its migrations in
`packages/db/prisma/migrations/`, and its TypedSQL files in `packages/db/prisma/sql/ext_<id>_*.sql`. Nothing
an extension needs requires editing a core path. The only exception is one line per app manifest
(section 3.3).

### 2.2 What the core guarantees to extensions

- **A stable, exported service API** for each core module, for example `DonationsService.record()`,
  `UsersService.findInScope()`, `UsersService.writeExtensionSection()` (EP-2) and `DonationTypesService.list()`.
  Extensions import these only from each module's public `index.ts`. The service API is a public contract,
  and a breaking change follows expand/contract like a database migration.
- **Versioned domain-event payloads** published in `packages/contracts`, for example `DonationRecorded.v1`,
  `DonationCorrected.v1`, `DonationCancelled.v1`, `ReceiptIssued.v1`, `UserInvited.v1` and
  `MembershipDeactivated.v1`.
- **A narrowed data client, `ExtensionPrisma<id>`** (EP-5). It is the only database handle an extension
  receives. Extensions never receive `TenantPrisma` or a `PrismaClient`.
- **Versioned read-only core views in schema `ext_api`** (EP-4). They are the only core relations that
  extension SQL may read.
- **The request pipeline.** SessionGuard, TenantGuard, ImpersonationGuard and PermissionGuard apply to
  extension routes exactly as they apply to core routes.
- **A donation-wizard deep link in the core SPA**:
  `/donations/new?memberId=<uuid>&typeId=<uuid>&returnTo=<path>`. The rules are:
  - The wizard loads the member and the type through the normal endpoints (`GET /api/v1/users/{id}`,
    `GET /api/v1/donation-types/{id}`), so the caller's resource scope applies. A parameter that returns
    403 or 404, or names a retired type, is ignored. The wizard then starts at that step and shows a
    notice.
  - Pre-fill is a convenience only. `POST /api/v1/donations` validates member, type, scope, amount and
    idempotency exactly as for a donation started from scratch. The Idempotency-Key is generated when the
    wizard opens, as today.
  - `returnTo` is accepted only as a relative path that starts with `/ext/` and contains no scheme and no
    `//`. Anything else is ignored, so the parameter cannot become an open redirect.
  - The deep link is part of the core donation-wizard story's scope. It is built once, for all
    extensions; no extension ever edits the wizard to get it.

## 3. The extension contract

The contract is split by runtime, so server code never reaches the browser bundle. The types live in
`packages/contracts/src/extensions/`. Server and browser framework types are imported there with
`import type` only, so they are erased at build time. The sketches below are normative for names and
semantics. Exact signatures are fixed in the implementation story.

### 3.1 `ExtensionDefinition` (runtime-neutral)

This is imported by the api, worker and web entry points. It contains only data and Zod schemas, so it is
safe in the browser. The SPA uses the same Zod schemas for its forms that the server uses for validation.

```ts
// packages/contracts/src/extensions/definition.ts
import type { ZodTypeAny } from 'zod';

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'manage';

export interface ExtensionDefinition {
  /** Stable id, /^[a-z][a-z0-9-]{1,30}$/. Never reused, never renamed. */
  id: string;
  version: string;
  displayName: string;

  /** EP-1: new permission areas, namespaced as `ext.<id>.<area>` by the registry. */
  permissionAreas?: Array<{
    area: string;
    label: string;
    actions: PermissionAction[];
    sensitive?: boolean;
  }>;

  /** EP-2: extra profile sections, stored in profiles.extension_data[<id>][<key>]. */
  profileSections?: Array<{
    key: string;
    label: string;
    schema: ZodTypeAny;
    area: string; // must be one of this extension's own areas
  }>;

  /** EP-4: report metadata, served under /api/v1/reports/ext.<id>.<key>. The runner is in the api entry. */
  reports?: Array<{
    key: string;
    label: string;
    area: string;
    filters: ZodTypeAny;
  }>;

  /** EP-7: grants suggested for seeded roles, applied only when an organisation enables the extension. */
  suggestedGrants?: Array<{
    seededRole: 'Organisation Administrator' | 'Donation Manager' | 'Member';
    area: string;
    actions: PermissionAction[];
  }>;
}
```

### 3.2 Runtime entry points

```ts
// packages/contracts/src/extensions/server.ts (type-only imports)
import type { Type } from '@nestjs/common';

export interface ApiExtension {
  definition: ExtensionDefinition;
  /** EP-6: NestJS module with the extension's own controllers and services. */
  apiModule?: Type<unknown>;
  /** EP-4: one runner per report key in definition.reports. */
  reportRunners?: Record<string, Type<unknown>>;
}

export interface WorkerExtension {
  definition: ExtensionDefinition;
  /** EP-3: reactions to committed core events (at least once). */
  eventSubscribers?: Array<{
    event: string; // e.g. 'DonationRecorded.v1'
    handler: Type<unknown>; // injectable class with handle(event, ctx)
  }>;
}

// packages/contracts/src/extensions/web.ts (type-only imports)
import type { ComponentType } from 'react';

export interface WebExtension {
  definition: ExtensionDefinition;
  /** EP-6: TanStack Router routes, mounted under /ext/<id>/. */
  routes?: unknown[];
  navEntries?: Array<{ label: string; path: string; area: string }>;
  /** EP-2: profile tab components, one per profile section key. */
  profileTabs?: Array<{ sectionKey: string; component: ComponentType }>;
}
```

Each entry point (`extensions/<id>/api/index.ts`, `.../worker/index.ts`, `.../web/index.ts`) exports one
value of its type. All three use the same `definition` object from `extensions/<id>/shared/definition.ts`.

### 3.3 Manifests

Each app has its own manifest. Each manifest is configuration that lists entry points and contains no
workflow logic:

| Manifest | Lists |
|---|---|
| `apps/api/src/extensions.manifest.ts` | `ApiExtension` entries from `extensions/<id>/api` |
| `apps/worker/src/extensions.manifest.ts` | `WorkerExtension` entries from `extensions/<id>/worker` |
| `apps/web/src/extensions.manifest.ts` | `WebExtension` entries from `extensions/<id>/web` |

A CI unit test (`extension-manifests.spec.ts`) asserts that the three manifests list the same extension ids
and that each id's entries use the same `definition` object. A lint rule forbids `extensions/*/web/**` from
importing `extensions/*/api/**`, `extensions/*/worker/**`, `@nestjs/*`, `@prisma/*` or `@cms/db`.

At boot, `ExtensionRegistry` checks every entry in the API and worker manifests and **refuses to start** if
any of these hold:

- an extension id is duplicated or malformed;
- an area, profile-section key or report key collides after namespacing;
- an area uses an action outside `PermissionAction`;
- a profile section, report, navigation entry or route references an area the extension did not declare;
- a report in the definition has no runner in the API entry, or a runner has no report;
- a subscriber names an event that is not published in `packages/contracts/src/events`;
- a route in `apiModule` has neither `@RequirePermission` nor `@Public`. This is the same boot assertion
  that applies to core routes. Extensions may not declare `@Public` routes without a platform-team review;
- a provider in `apiModule`, a report runner or a subscriber injects `TenantPrisma` or `PrismaClient`.
  This is a runtime backstop to the lint rule in section 7.

## 4. Extension points

### EP-1 Permission areas

An extension adds areas to the RBAC matrix, which is otherwise *12+ core areas × 6 actions*. See
[section 5](#5-edge-case-an-extension-needs-a-new-permission-area) for details. `role_permissions.area` is
already free text, validated against the registry, so a new area needs no schema change in `rbac`.

### EP-2 Profile sections

- Non-sensitive extension data is stored in `profiles.extension_data` (JSONB) at path `{<id>, <key>}`.
- It is served through the existing `/api/v1/users/{id}/profile/{section}` endpoint, with
  `section = ext.<id>.<key>`. The SPA shows it through the extension's `profileTabs`.
- The `users` module gates access by the section's declared area. Resource scope works as for core
  sections: self, managed child, or users visible to the caller.
- Optimistic concurrency (`version` / `If-Match`) and audit entries come from the core profile workflow.

The following rules are normative for the `users` module:

- **Reads never leak extension data.** Core profile reads, user lists, search, exports and reports select
  explicit columns and never include `extension_data`. A section endpoint for `ext.<id>.<key>` returns only
  `extension_data -> '<id>' -> '<key>'`, and only after the caller passes the check for that section's area.
- **Writes touch one path only.** A write to `ext.<id>.<key>` validates the body with that section's Zod
  schema, then runs one `UPDATE ... SET extension_data = jsonb_set(coalesce(extension_data, '{}'),
  '{<id>,<key>}', $value, true)` guarded by the row `version`. A client never sends, and the server never
  writes, the whole `extension_data` object. One extension's section therefore cannot overwrite another
  section or another extension's data.
- **Extension-initiated writes** (for example, a summary refreshed by a subscriber) go through
  `UsersService.writeExtensionSection(extId, key, userId, value)`. This service applies the same Zod schema,
  the same single-path write and the same audit entry. It accepts only the calling extension's own id.
- **A generated test** walks every core endpoint in the OpenAPI inventory as a user who holds no extension
  area, and asserts that no response contains `extension_data` or any seeded extension value.

Sensitive extension data must **not** go in `extension_data`. It goes in an extension-owned table (EP-5)
behind an area marked `sensitive: true`. This mirrors how the core separates salary.

### EP-3 Domain-event subscribers

- Subscribers run in the **worker**. They are fed from the transactional outbox through BullMQ queue
  `ext.<id>.events`.
- They therefore only ever see **committed** core events, and are never called inside a core transaction.
- Each handler gets an `ExtensionPrisma<id>` (EP-5) scoped to the event's `org_id`, plus the event id as an
  idempotency key. It does not get `TenantPrisma`.
- A failing handler is retried with backoff and then dead-lettered (visible in Bull Board). It cannot roll
  back, block or delay the donation, receipt, obligation or audit write that produced the event.
- In-process `EventEmitter2` listeners are reserved for core modules. Extensions do not get them, because an
  exception in a synchronous listener could otherwise surface inside a core request.
- Subscribers read core data only through core service APIs or the `ext_api` views (EP-4). To change core
  data, an extension calls the same core service a user action would call (see EP-6).
- In the worker there is no requesting user. `ExtensionPrisma` therefore sets the `ext_api` scope to the
  whole organisation (EP-4). The subscriber's output is extension-owned state. Anything later served to a
  user from that state is gated by the extension's areas at request time.

### EP-4 Report definitions and extension SQL

- An extension report is registered under `ext.<id>.<key>` and served by the existing
  `/api/v1/reports/{reportKey}` endpoint and CSV export job.
- Its runner executes TypedSQL from `packages/db/prisma/sql/ext_<id>_*.sql` through
  `ExtensionPrisma<id>.$queryRawTyped`. The query runs inside the request's RLS transaction under the
  `cms_ext` role (EP-5), so tenant isolation is the same as for core reports.
- **Extension SQL may reference only two kinds of relation:** the extension's own `ext_<id>_*` tables, and
  the views in schema `ext_api`. The `cms_ext` role has no privileges on core tables at all, so any other
  reference fails with `permission denied`. An SQL lint over `packages/db/prisma/sql/ext_*.sql` catches this
  earlier, in CI. The lint also rejects any statement other than `SELECT` / `WITH ... SELECT`.
- **The `ext_api` views** are core-owned, versioned and read-only. The first set is:
  - `ext_api.donations_v1`: id, org_id, donor_user_id, donation_type_id, amount, currency, donation_date,
    status. It has no notes and no FX internals.
  - `ext_api.donation_types_v1`: id, org_id, name, is_mandatory, retired_at.
  - `ext_api.members_v1`: user_id, org_id, display_name, status.
  - A new view or column is a core change and needs its own story. A breaking change ships as `_v2`.
- **Sensitive core data is never readable from extension SQL.** No `ext_api` view exposes profiles,
  profile sections, salary or marital tables, relationships, email or phone, audit_log, sessions,
  impersonation records, receipts' documents or donation notes.
- **Resource scope is built into the views.** It is not a helper the extension author must remember.
  - Before running any extension query, `ExtensionPrisma` sets the transaction-local GUCs
    `app.scope_type_ids` and `app.scope_user_ids`. Their values come from the caller's resource scope, as
    computed by the core policy functions (US-32, US-61, US-23, US-73). `*` means organisation-wide.
  - The views filter on these GUCs: `donation_type_id = ANY(...)` for managers, `donor_user_id = ANY(...)`
    for members.
  - If a GUC is unset, the views return no rows, so they fail closed.
- **Ownership.** The views are owned by a dedicated `cms_ext_views` role (NOLOGIN, NOBYPASSRLS, SELECT on the
  listed core columns only). They are defined `WITH (security_barrier = true)`. Because the owner is not the
  owner of the underlying tables, the tables' RLS policies apply through the view. `cms_ext` gets `SELECT` on
  `ext_api.*` only.
- Money columns follow the core rule: grouped by currency, never summed across currencies (US-40).

### EP-5 Extension-owned data and `ExtensionPrisma<id>`

**Tables.**

- An extension owns its tables, declared in `packages/db/prisma/schema/ext-<id>.prisma`. This relies on
  Prisma's multi-file schema folder.
- Its migrations are hand-extended with the same mandatory SQL as core tables:
  - an `org_id` column,
  - `ENABLE` / `FORCE ROW LEVEL SECURITY` with the standard `org_id = current_setting('app.org_id')::uuid`
    policy,
  - composite foreign keys `(org_id, <core>_id)` that reference core tables' `(org_id, id)` unique keys,
  - `SELECT, INSERT, UPDATE, DELETE` granted to `cms_ext` only. `cms_app` gets no grants on `ext_*` tables.
- Table names are prefixed `ext_<id>_`.
- Foreign keys into core tables use `ON DELETE RESTRICT`. Core financial records are never deleted, and an
  extension must not cascade into them or block their soft-delete. A composite foreign key needs only the
  `REFERENCES` privilege on the core key, and the migration grants that and nothing else.
- An extension never adds columns, triggers or constraints to a core table. If it needs one, that is a core
  change and goes through its own story.

**The narrowed client.** `ExtensionPrisma<id>` is the only data handle injected into extension code (API
providers, report runners, worker subscribers). It is built by the `extensions` core module over the same
per-request (or per-job) interactive transaction as `TenantPrisma`, and enforces three layers:

1. **Type.** It exposes only the model delegates generated from `ext-<id>.prisma` and a
   `$queryRawTyped` that accepts only TypedSQL named `ext_<id>_*`. It has no core model delegates and no
   `$executeRaw`, `$executeRawUnsafe`, `$queryRaw`, `$queryRawUnsafe`, `$transaction`, `$extends` or
   `$connect`.
2. **Runtime.** It is a Proxy. Any other property access throws `ExtensionBoundaryError`, which is logged and
   counted in a metric. This catches `as any` casts and dynamic property access that the type layer cannot
   catch.
3. **Database.** Each operation runs as
   `SET LOCAL ROLE cms_ext; set scope GUCs; <query>; RESET ROLE` on the transaction's connection.
   - A per-transaction lock serialises these steps, so a concurrent core call in the same transaction never
     runs as `cms_ext`, and an extension query never runs as `cms_app`.
   - `cms_ext` is NOLOGIN, NOSUPERUSER and NOBYPASSRLS. It has DML on `ext_*` tables, SELECT on `ext_api.*`,
     and **no privileges on any core table**.
   - `cms_app` is granted `cms_ext` with `INHERIT FALSE, SET TRUE`, so it can switch to the role but does
     not inherit its privileges.
   - The app.* GUCs are transaction settings, not role settings, so RLS keeps the same tenant after the
     switch.
   - Even a query that got past layers 1 and 2 cannot write `donations`, `receipts`, `member_obligations`,
     `fx_snapshots`, `audit_log` or any other core table.

The two new roles (`cms_ext`, `cms_ext_views`) extend the baseline's `cms_migrator` / `cms_app` model. Like
the RLS policies, they are created in hand-written migration SQL.

### EP-6 API routes and SPA screens

- **API.** The extension's `apiModule` mounts controllers under `/api/v1/ext/<id>/...`. They pass through
  the full guard pipeline, and use only `ExtensionPrisma<id>` and core service APIs.
- **Financial actions.** Any money movement (recording, correcting or cancelling a donation) calls
  `DonationsService.record()`, `.correct()` or `.cancel()`, or sends the user to the core wizard through the
  deep link in section 2.2. Receipts, obligations, FX, audit and outbox therefore behave exactly as they do
  for a donation entered in the core wizard.
  - An extension cannot write to `donations`, `receipts`, `member_obligations`, `fx_snapshots` or
    `audit_log` directly.
  - RLS alone would not stop this, because it scopes by tenant, not by caller. The guarantee comes from
    `ExtensionPrisma` (EP-5): no core delegates, no raw SQL, and the `cms_ext` role with no core grants.
  - Lint rules (section 7) catch attempts earlier, but they are not what the guarantee rests on.
- **SPA.** The extension's web entry (`extensions/<id>/web/`) contributes TanStack Router routes under
  `/ext/<id>/`, navigation entries and profile tabs. `apps/web/src/extensions.manifest.ts` lists it.
  - Navigation shows an entry only when the `/api/me` permission set contains the entry's area.
  - Hiding is cosmetic only; the server re-checks every request.

### EP-7 Per-organisation enablement

- Extensions are off by default for every organisation. Table `organisation_extensions` holds
  `org_id`, `extension_id`, `enabled_at`, `enabled_by`, `disabled_at` and `disabled_by`, and is protected by
  RLS. It is part of the `extensions` core module and is added once, by the story that implements this
  document.
- A super administrator enables or disables an extension through
  `/api/v1/platform/organisations/{id}/extensions/{extId}`. That one request:
  - writes the `organisation_extensions` row,
  - applies `suggestedGrants` to the target organisation's seeded roles (section 5),
  - writes an audit row in the target organisation,
  - bumps the target organisation's `perms_version`.
- **Platform write path.** These writes land in another organisation, so they cannot use the caller's
  session tenant. They also cannot use the US-7 read-only platform view. They run in a **platform tenant
  transaction**:
  1. `PlatformGuard` checks that the session user holds `super_admin` in `platform_roles`.
     ImpersonationGuard has already blocked platform routes for impersonated sessions.
  2. The `platform` module opens a normal read-write transaction through
     `PlatformTenantTx.run(targetOrgId, fn)`. It verifies that the target organisation exists, then sets
     `app.org_id = <target org>`, `app.user_id = app.actor_id = <super admin user id>` and
     `app.platform_actor = 'on'` with `set_config(..., true)`.
  3. The ordinary `org_id = current_setting('app.org_id')::uuid` policies apply unchanged. No new RLS policy
     and no BYPASSRLS are involved, and the transaction can touch only the target organisation's rows.
  4. Audit rows record `actor_user_id` = the super admin and `org_id` = the target organisation, with action
     `platform.extension.enabled` or `platform.extension.disabled`. `app.platform_actor` marks the row as a
     platform action in the audit view.
  5. `PlatformTenantTx` is exported only inside the `platform` module. Extensions and other modules cannot
     inject it (enforced by the import-boundary lint and the boot check in section 3.3).
- This is the same mechanism the `platform` module needs for organisation set-up (US-1) and user migration
  between organisations (US-70). This document names it so those stories reuse it. If one of them lands
  first with a different mechanism, this section follows that one.
- If a request reaches an extension route for an organisation that has not enabled the extension, it gets a
  404. A route that reveals no data needs no special treatment beyond that.
- Event subscribers and reports skip organisations that have not enabled the extension.

## 5. Edge case: an extension needs a new permission area

1. **Declaration.** The extension lists the area in `permissionAreas` in its `ExtensionDefinition`. The
   registry stores it as `ext.<id>.<area>`, so it cannot collide with a core area (`donations`, `roles`, …)
   or with another extension's areas. Core area names are reserved and contain no `.`.
2. **Validation.** `rbac` validates `role_permissions.area` against `core areas ∪ registry areas`. The area
   list is not hard-coded in `rbac`, so registering an area needs no edit to `rbac`.
3. **No implicit access (fail closed).** A new area starts with no grants on any role, including
   Organisation Administrator. Until someone grants it, every route that requires it returns 403.
4. **Granting.** An organisation administrator grants the area in the existing role editor
   (`/api/v1/roles/{id}/permissions`). The editor lists registered areas for enabled extensions next to
   core areas.
   - If the extension declares `suggestedGrants`, they are applied to the organisation's seeded roles once,
     in the same platform tenant transaction that enables the extension (EP-7).
   - Each grant writes a `role.permission.granted` audit row and bumps `perms_version`. Users pick the grant
     up on their next request (US-17).
5. **Sensitive areas.** `sensitive: true` areas are highlighted in the role editor and never included in
   `suggestedGrants` for `Member`. Like salary, they need an explicit grant.
6. **Disable.** Disabling the extension keeps its `role_permissions` rows as history.
   - The effective permission set filters out areas of disabled extensions.
   - `perms_version` is bumped, so those grants stop working on the next request.
   - Re-enabling restores the previous grants without re-granting.
7. **Removal from the codebase.** If an area disappears from the registry, its rows stay (audit history)
   and are ignored when effective permissions are computed. Boot logs a warning listing the orphaned areas.
   They are deleted only by an explicit, audited platform maintenance command.
8. **Impersonation.** Extension areas follow the same impersonation rules as core areas.
   ImpersonationGuard's block list (impersonation start, password change, role and permission edits,
   platform routes) is enforced before PermissionGuard, so an extension cannot open a way around it.

## 6. Worked example: orphan sponsorship

**Feature.** A charity runs an orphan sponsorship programme.

- Members sponsor a child for a monthly amount.
- Staff record payments.
- The charity wants a "Sponsorships" tab on the member profile, a list of sponsorships, and a
  "sponsorships in arrears" report.
- Other charities on the platform must not see any of this.

### 6.1 How each need maps to an extension point

| Need | Extension point | Core workflow used, unchanged |
|---|---|---|
| Who may see or manage sponsorships | EP-1: area `ext.sponsorship.sponsorships` (view, create, edit, manage); area `ext.sponsorship.children` (view, edit, `sensitive: true`) | Permission: role editor, PermissionGuard, perms_version |
| Sponsored child records, sponsorship agreements | EP-5: tables `ext_sponsorship_children` and `ext_sponsorship_agreements(org_id, sponsor_user_id, donation_type_id, monthly_amount, currency, starts_on, ends_on, paid_through)`, with composite FKs to `users` and `donation_types`. Accessed only through `ExtensionPrisma<'sponsorship'>` | Organisation and user: RLS, composite tenant FKs |
| Recording a sponsorship payment | EP-6 with the section 2.2 deep link. The sponsorship screen links to `/donations/new?memberId=<sponsor>&typeId=<agreement type>&returnTo=/ext/sponsorship/agreements/<id>`. The type is an ordinary core type, e.g. "Orphan Sponsorship", created by the admin through `donation-types`. The core wizard records the donation through `POST /api/v1/donations` and `DonationsService.record()` | Donation and financial: idempotency, receipt number, obligation recalculation, FX, audit and outbox, all in one transaction as today |
| Keeping "paid through" up to date | EP-3: worker subscriber on `DonationRecorded.v1`, `DonationCorrected.v1` and `DonationCancelled.v1`. It filters by the agreement's `donation_type_id`, reads donations through `DonationsService`, and writes `paid_through` with `ExtensionPrisma` | None changed. A failure is retried in the extension's own queue and the donation is unaffected |
| "Sponsorships" profile tab | EP-2: section `ext.sponsorship.summary` (non-sensitive: number of active agreements, paid-through month), refreshed by the subscriber through `UsersService.writeExtensionSection()` | User: profile endpoint, scope, If-Match, audit |
| Arrears report | EP-4: report `ext.sponsorship.arrears`, area `ext.sponsorship.sponsorships`. Its SQL joins `ext_sponsorship_agreements` to `ext_api.donations_v1`, so the caller's managed-type scope applies inside the view. Amounts are grouped by currency | Financial: report runner, RLS, CSV export |
| Only for charities that run sponsorship | EP-7: a super admin enables `sponsorship` per organisation through the platform tenant transaction | Organisation: platform audit |

### 6.2 Files touched

| Path | Change |
|---|---|
| `extensions/sponsorship/shared/definition.ts` | **new**: the `ExtensionDefinition` (areas, profile section, report metadata, suggested grants) |
| `extensions/sponsorship/api/index.ts`, `sponsorship.module.ts`, `*.controller.ts`, `*.service.ts`, `reports/arrears.runner.ts` | **new** |
| `extensions/sponsorship/worker/index.ts`, `payment-subscriber.ts` | **new** |
| `extensions/sponsorship/web/index.ts`, routes, nav entry, profile tab | **new** |
| `packages/db/prisma/schema/ext-sponsorship.prisma` | **new** |
| `packages/db/prisma/sql/ext_sponsorship_arrears.sql` | **new**: reads only `ext_sponsorship_*` and `ext_api.*` |
| `packages/db/prisma/migrations/<ts>_ext_sponsorship_init/migration.sql` | **new**: tables, RLS, composite FKs, grants to `cms_ext` |
| `apps/api/src/extensions.manifest.ts` | **one line added**: the sponsorship API entry |
| `apps/worker/src/extensions.manifest.ts` | **one line added**: the sponsorship worker entry |
| `apps/web/src/extensions.manifest.ts` | **one line added**: the sponsorship web entry |
| `apps/api/src/modules/**` (all core modules) | **unchanged** |
| `apps/worker/src/**` outside the manifest | **unchanged** |
| `apps/web/src/**` outside the manifest, including the donation wizard | **unchanged**: the deep link is an existing core guarantee (section 2.2) |
| `packages/db/prisma/schema/core*.prisma`, core migrations, `ext_api` views | **unchanged** |
| `packages/contracts/src/events/**`, `packages/contracts/src/extensions/**` | **unchanged**: the existing `DonationRecorded.v1` etc. and the extension contract are consumed |

The three manifest lines are the only edits outside new paths. Each registers an entry point, contains no
workflow logic, and is the same kind of edit as adding a NestJS module import.

### 6.3 Why the core workflows are unaffected

- **Organisation.** No organisation table or setting changes. Enablement uses the existing
  `organisation_extensions` mechanism and the platform tenant transaction.
- **User.** Users, memberships, relationships and the core profile sections are untouched. The new tab is
  an additional section served by the existing endpoint. It is written at a single JSONB path and never
  returned by core endpoints.
- **Donation.** A sponsorship payment *is* a core donation, recorded by the core wizard and the core use
  case. Corrections and cancellations use the core CorrectDonation and cancel flows, so receipt replacement
  (US-47) behaves as for any other donation.
- **Permission.** The new areas go through the existing matrix. Nothing in `rbac`, the guards or the
  impersonation rules changes.
- **Financial.** Receipt numbering, obligation recalculation, FX conversion, audit chain and outbox run
  inside the core transaction, which the extension cannot join. The extension has no database privilege on
  any core financial table. It cannot write them, and it can read donations only through the scoped
  `ext_api.donations_v1` view. The extension's own state (`paid_through`) is derived after commit and can
  always be rebuilt from core donations.

## 7. Guardrails and how they are enforced

| Rule | Enforcement |
|---|---|
| Extensions cannot write core tables | `ExtensionPrisma<id>` (EP-5): no core delegates or raw SQL in the type, a Proxy that throws at runtime, and every query run as `cms_ext`, which has no privileges on core tables. Integration test in CI: an extension fixture tries `donation.update`, `memberObligation.update`, `receipt.create` and `fxSnapshot.create`, both through casts on `ExtensionPrisma` and through raw `UPDATE`/`INSERT` as `cms_ext`. Every attempt must fail and leave the rows unchanged |
| Extensions never hold `TenantPrisma` or a `PrismaClient` | ESLint rule under `extensions/**`: no import of `@cms/db`, `@prisma/*` or the `TenantPrisma` / `PlatformTenantTx` tokens, and no `@Inject` of them. Boot check in `ExtensionRegistry` (section 3.3) as a runtime backstop |
| Extensions import only public core APIs | ESLint import-boundary rule: `extensions/**` may import only `@cms/contracts`, the core modules' public `index.ts` exports, and its own folder |
| Extension SQL reads only its own tables and `ext_api` views | SQL lint over `packages/db/prisma/sql/ext_*.sql`: SELECT only, relations limited to `ext_<id>_*` and `ext_api.*`. Database backstop: `cms_ext` has no grants on core tables. Integration test: `SELECT` from `profile_sections`, the salary table and `donations` as `cms_ext` fails with `permission denied` |
| Extension reports respect resource scope | Scope GUCs set by `ExtensionPrisma` and applied inside the `ext_api` views. Unset GUCs return no rows. The generated cross-tenant and authorisation suite covers `/api/v1/reports/ext.*` as a manager of one type |
| Core endpoints never return `extension_data` | Explicit column selection in `users` (EP-2), plus the generated leak test over the OpenAPI inventory |
| Extension PRs do not modify core paths | CODEOWNERS on `apps/api/src/modules/**`, `apps/web/src/**`, `apps/worker/src/**` and core schema files, plus a CI check that flags PRs touching both `extensions/**` and core paths other than the three manifests |
| Server code never reaches the browser | Per-runtime entry points (section 3.2), the web lint rule in section 3.3, and the Vite build |
| The three manifests agree | `extension-manifests.spec.ts` (section 3.3) |
| Every extension route declares a permission | Same lint rule and boot assertion as core routes |
| Extension tables are tenant-isolated | Migration lint: every `ext_*` table has `org_id`, `FORCE ROW LEVEL SECURITY` and grants to `cms_ext` only. The generated cross-tenant suite covers `/api/v1/ext/**` routes from the OpenAPI inventory |
| Extensions never run inside core transactions | The contract offers no hook into them. Subscribers are worker-side and fed only from the outbox |
| Platform writes stay within one target organisation | `PlatformTenantTx` (EP-7): PlatformGuard, the standard RLS policy with `app.org_id` set to the target, and no BYPASSRLS. Integration test: an enablement for organisation A writes no row in organisation B |
| The core keeps working when an extension is broken or disabled | CI runs the core integration and E2E suites twice, once with all manifests empty and once with all extensions registered. Both must pass |

## 8. Acceptance trace (US-67)

| Checklist item | Where |
|---|---|
| Extension points are named | Section 4 (EP-1 … EP-7), contract in section 3 |
| A sample charity-specific feature is shown | Section 6 (orphan sponsorship) |
| The sample needs no change to the core organisation, user, donation, permission or financial workflows | Sections 6.2 and 6.3, relying on the core guarantees in section 2.2 |
| The core workflows cannot be bypassed by an extension | EP-5 (`ExtensionPrisma`, `cms_ext`), EP-4 (`ext_api` views), section 7 |
| Edge case: an extension needs a new permission area | Section 5 |

## 9. Out of scope and open questions

- The following belong to implementation stories that follow the application scaffold. This document is
  their specification:
  - the code for `ExtensionRegistry`, `ExtensionPrisma`, `PlatformTenantTx` and `organisation_extensions`;
  - the `cms_ext` / `cms_ext_views` roles and the `ext_api` views;
  - the lint rules, the SQL lint, the manifest-agreement test and the dual-manifest CI run.
- The donation-wizard deep link (section 2.2) must be in the acceptance criteria of the core donation-wizard
  story. If that story ships without it, adding it later is a one-off core change, not an extension change.
- Third-party or runtime-loaded plugins are out of scope. Extensions are first-party code, reviewed and
  shipped in the same image.
- Open: should an organisation administrator, rather than only a super administrator, be able to enable an
  extension for their own organisation?
- Open: may an extension declare `@Public` routes, for example a public sponsorship sign-up page? The
  current answer is no without a dedicated security review.
- Open: confirm that `PlatformTenantTx` (EP-7) is also the mechanism for US-1 and US-70. If those stories
  choose another, this document should be updated to reference it.
