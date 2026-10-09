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
- edit the core Prisma schema files or core migrations, or
- add a step inside a core transaction.

An extension uses the core only through the contracts described below.

## 2. The core boundary

### 2.1 Core modules

The following NestJS modules in `apps/api/src/modules/` and their tables are **core**:

| Core workflow | Modules |
|---|---|
| Organisation | `organisations`, `platform` |
| User | `identity`, `users` (profiles), `relationships`, `impersonation` |
| Permission | `rbac` (roles, role_permissions, membership_roles, platform_roles) |
| Donation | `donation-types`, `donations` |
| Financial | `obligations`, `fx`, `receipts`, `reports` (core report set) |
| Cross-cutting | `audit`, `notifications`, the global guard pipeline, `TenantPrisma` |

Extensions live under `extensions/<extension-id>/` (API, worker and SPA parts) and in
`packages/db/prisma/schema/ext-<extension-id>.prisma` with their own migrations. Nothing an extension needs
requires editing the paths above.

### 2.2 What the core guarantees to extensions

- **A stable, exported service API** for each core module, for example `DonationsService.record()`,
  `UsersService.findInScope()` and `DonationTypesService.list()`. The service API is a public contract. A
  breaking change follows expand/contract like a database migration.
- **Versioned domain-event payloads** published in `packages/contracts`, for example `DonationRecorded.v1`,
  `DonationCorrected.v1`, `DonationCancelled.v1`, `ReceiptIssued.v1`, `UserInvited.v1` and
  `MembershipDeactivated.v1`.
- **The request pipeline.** SessionGuard, TenantGuard, ImpersonationGuard, PermissionGuard and the
  request-scoped `TenantPrisma` apply to extension routes exactly as they apply to core routes.

## 3. The `ExtensionModule` contract

Every extension exports exactly one manifest. The contract types live in
`packages/contracts/src/extensions.ts`. The sketch below is normative for names and semantics. Exact
signatures are fixed in the implementation story.

```ts
import type { Type } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'manage';

export interface ExtensionModule {
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

  /** EP-2: extra profile sections, stored in profiles.extension_data[<id>]. */
  profileSections?: Array<{
    key: string;
    label: string;
    schema: ZodTypeAny;
    area: string; // must be one of this extension's own areas
  }>;

  /** EP-3: reactions to committed core events (worker, at least once). */
  eventSubscribers?: Array<{
    event: string; // e.g. 'DonationRecorded.v1'
    handler: Type<unknown>; // injectable class with handle(event, ctx)
  }>;

  /** EP-4: report definitions served under /api/v1/reports/ext.<id>.<key>. */
  reports?: Array<{
    key: string;
    label: string;
    area: string;
    filters: ZodTypeAny;
    run: Type<unknown>; // injectable class using TypedSQL inside the RLS transaction
  }>;

  /** EP-6: NestJS module with the extension's own controllers and services. */
  apiModule?: Type<unknown>;

  /** EP-7: grants suggested for seeded roles, applied only when an organisation enables the extension. */
  suggestedGrants?: Array<{
    seededRole: 'Organisation Administrator' | 'Donation Manager' | 'Member';
    area: string;
    actions: PermissionAction[];
  }>;
}
```

The extensions are listed in one manifest file, `apps/api/src/extensions.manifest.ts`, which the worker and
the SPA also read. The file is configuration that lists modules. It contains no workflow logic. At boot,
`ExtensionRegistry` checks every entry and **refuses to start** if any of these hold:

- an extension id is duplicated or malformed;
- an area, profile-section key or report key collides after namespacing;
- an area uses an action outside `PermissionAction`;
- a profile section, report or route references an area the extension did not declare;
- a route in `apiModule` has neither `@RequirePermission` nor `@Public`. This is the same boot assertion
  that applies to core routes. Extensions may not declare `@Public` routes without a platform-team review.

## 4. Extension points

### EP-1 Permission areas

An extension adds areas to the RBAC matrix, which is otherwise *12+ core areas × 6 actions*. See
[section 5](#5-edge-case-an-extension-needs-a-new-permission-area) for details. `role_permissions.area` is
already free text, validated against the registry, so a new area needs no schema change in `rbac`.

### EP-2 Profile sections

- Non-sensitive extension data is stored in `profiles.extension_data` (JSONB), keyed by extension id. The
  extension's Zod schema validates it on every write.
- The data is served through the existing `/api/v1/users/{id}/profile/{section}` endpoint, with
  `section = ext.<id>.<key>`.
- The `users` module delegates validation to the registry and gates access by the section's declared area.
  Resource scope works as for core sections: self, managed child, or users visible to the caller.
- Optimistic concurrency (`version` / `If-Match`) and audit entries come from the core profile workflow.

Sensitive extension data must **not** go in `extension_data`. It goes in an extension-owned table (EP-5)
behind an area marked `sensitive: true`. This mirrors how the core separates salary.

### EP-3 Domain-event subscribers

- Subscribers run in the **worker**. They are fed from the transactional outbox through BullMQ queue
  `ext.<id>.events`.
- They therefore only ever see **committed** core events, and are never called inside a core transaction.
- Each handler gets a `TenantPrisma` scoped to the event's `org_id`, plus the event id as an idempotency key.
- A failing handler is retried with backoff and then dead-lettered (visible in Bull Board). It cannot roll
  back, block or delay the donation, receipt, obligation or audit write that produced the event.
- In-process `EventEmitter2` listeners are reserved for core modules. Extensions do not get them, because an
  exception in a synchronous listener could otherwise surface inside a core request.
- Subscribers only get read access to core data, through core service APIs. To change core data, an
  extension calls the same core service a user action would call (see EP-6).

### EP-4 Report definitions

- An extension report is registered under `ext.<id>.<key>` and served by the existing
  `/api/v1/reports/{reportKey}` endpoint and CSV export job.
- It runs TypedSQL (`$queryRawTyped`) inside the request's RLS transaction, so tenant isolation is the same
  as for core reports.
- Resource scope is applied by the extension's query using the scope helpers exported by `reports`. For
  example, a manager's `donation_type_id IN (...)` filter is part of the SQL, not applied after the query
  (US-32, US-61).
- Money columns follow the core rule: grouped by currency, never summed across currencies (US-40).

### EP-5 Extension-owned data

- An extension owns its tables, declared in `packages/db/prisma/schema/ext-<id>.prisma`. This relies on
  Prisma's multi-file schema folder.
- Its migrations are hand-extended with the same mandatory SQL as core tables:
  - an `org_id` column,
  - `ENABLE` / `FORCE ROW LEVEL SECURITY` with the standard `org_id = current_setting('app.org_id')::uuid`
    policy,
  - composite foreign keys `(org_id, <core>_id)` that reference core tables' `(org_id, id)` unique keys,
  - grants to `cms_app`.
- Table names are prefixed `ext_<id>_`.
- Foreign keys into core tables use `ON DELETE RESTRICT`. Core financial records are never deleted, and an
  extension must not cascade into them or block their soft-delete.
- An extension never adds columns, triggers or constraints to a core table. If it needs one, that is a core
  change and goes through its own story.

### EP-6 API routes and SPA screens

- **API.** The extension's `apiModule` mounts controllers under `/api/v1/ext/<id>/...`. They pass through
  the full guard pipeline and use only `TenantPrisma` and core service APIs.
- **Financial actions.** Any money movement (recording, correcting or cancelling a donation) calls
  `DonationsService.record()`, `.correct()` or `.cancel()`. Receipts, obligations, FX, audit and outbox
  therefore behave exactly as they do for a donation entered in the core wizard. An extension cannot write to
  `donations`, `receipts`, `member_obligations`, `fx_snapshots` or `audit_log` directly. RLS does not stop
  this on its own, so an ESLint import-boundary rule does: extensions may not import `@cms/db` core model
  delegates or another module's internals.
- **SPA.** The extension contributes TanStack Router routes and navigation entries from
  `apps/web/src/extensions/<id>/`. They are listed in the same manifest. Navigation shows an entry only when
  the `/api/me` permission set contains one of its areas. Hiding is cosmetic only; the server re-checks every
  request.

### EP-7 Per-organisation enablement

- Extensions are off by default for every organisation. Table `organisation_extensions` holds
  `org_id`, `extension_id`, `enabled_at`, `enabled_by`, `disabled_at` and `disabled_by`, and is protected by
  RLS. It is part of the `extensions` core module and is added once, by the story that implements this
  document.
- A super administrator enables or disables an extension through
  `/api/v1/platform/organisations/{id}/extensions/{extId}`. Each change writes an audit row in the target
  organisation and bumps its `perms_version`.
- If a request reaches an extension route for an organisation that has not enabled the extension, it gets a
  404. A route that reveals no data needs no special treatment beyond that.
- Event subscribers and reports skip organisations that have not enabled the extension.

## 5. Edge case: an extension needs a new permission area

1. **Declaration.** The extension lists the area in `permissionAreas`. The registry stores it as
   `ext.<id>.<area>`, so it cannot collide with a core area (`donations`, `roles`, …) or with another
   extension's areas. Core area names are reserved and contain no `.`.
2. **Validation.** `rbac` validates `role_permissions.area` against `core areas ∪ registry areas`. The area
   list is not hard-coded in `rbac`, so registering an area needs no edit to `rbac`.
3. **No implicit access (fail closed).** A new area starts with no grants on any role, including
   Organisation Administrator. Until someone grants it, every route that requires it returns 403.
4. **Granting.** An organisation administrator grants the area in the existing role editor
   (`/api/v1/roles/{id}/permissions`), which lists registered areas for enabled extensions next to core
   areas.
   - If the extension declares `suggestedGrants`, they are applied to the organisation's seeded roles once,
     in the same transaction that enables the extension.
   - Each grant writes a `role.permission.granted` audit row and bumps `perms_version`. Users pick the grant
     up on their next request (US-17).
5. **Sensitive areas.** `sensitive: true` areas are highlighted in the role editor and never included in
   `suggestedGrants` for `Member`. Like salary, they need an explicit grant.
6. **Disable.** Disabling the extension keeps its `role_permissions` rows, so they are history. The effective
   permission set filters out areas of disabled extensions, and `perms_version` is bumped so they stop
   working on the next request. Re-enabling restores the previous grants without re-granting.
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
| Sponsored child records, sponsorship agreements | EP-5: tables `ext_sponsorship_children`, `ext_sponsorship_agreements(org_id, sponsor_user_id, donation_type_id, monthly_amount, currency, starts_on, ends_on)`, with composite FKs to `users` and `donation_types` | Organisation and user: RLS, composite tenant FKs |
| Recording a sponsorship payment | EP-6: the sponsorship screen opens the **core donation wizard**, pre-filled with the sponsor and the agreement's donation type (an ordinary core type, e.g. "Orphan Sponsorship", created by the admin through `donation-types`). The donation is recorded by `DonationsService.record()` | Donation and financial: idempotency, receipt number, obligation recalculation, FX, audit, outbox, all in one transaction as today |
| Keeping "paid through" up to date | EP-3: subscriber on `DonationRecorded.v1`, `DonationCorrected.v1` and `DonationCancelled.v1`. It filters by the agreement's `donation_type_id` and recomputes `ext_sponsorship_agreements.paid_through` from donations read through `DonationsService` | None changed. A failure is retried in the extension's own queue and the donation is unaffected |
| "Sponsorships" profile tab | EP-2: section `ext.sponsorship.summary` (non-sensitive: number of active agreements, paid-through month) | User: profile endpoint, scope, If-Match, audit |
| Arrears report | EP-4: report `ext.sponsorship.arrears`, area `ext.sponsorship.sponsorships`, scoped to the caller's managed donation types, amounts grouped by currency | Financial: report runner, RLS, CSV export |
| Only for charities that run sponsorship | EP-7: a super admin enables `sponsorship` per organisation | Organisation: platform audit |

### 6.2 Files touched

| Path | Change |
|---|---|
| `extensions/sponsorship/api/sponsorship.extension.ts` | **new**: the `ExtensionModule` manifest |
| `extensions/sponsorship/api/sponsorship.module.ts`, `*.controller.ts`, `*.service.ts` | **new** |
| `extensions/sponsorship/worker/payment-subscriber.ts` | **new** |
| `extensions/sponsorship/api/reports/arrears.sql` + runner | **new** |
| `extensions/sponsorship/web/*` | **new**: routes, nav entry, profile tab |
| `packages/db/prisma/schema/ext-sponsorship.prisma` | **new** |
| `packages/db/prisma/migrations/<ts>_ext_sponsorship_init/migration.sql` | **new**: tables, RLS, composite FKs, grants |
| `apps/api/src/extensions.manifest.ts` | **one line added**: `sponsorshipExtension` |
| `apps/api/src/modules/**` (all core modules) | **unchanged** |
| `packages/db/prisma/schema/core*.prisma`, core migrations | **unchanged** |
| `packages/contracts/src/events/**` | **unchanged**: the existing `DonationRecorded.v1` etc. are consumed |

The one manifest line is the only edit outside new paths. It registers the module, contains no workflow
logic, and is the same kind of edit as adding a NestJS module import.

### 6.3 Why the core workflows are unaffected

- **Organisation.** No organisation table or setting changes. Enablement uses the existing
  `organisation_extensions` mechanism.
- **User.** Users, memberships, relationships and the core profile sections are untouched. The new tab is
  an additional section served by the existing endpoint.
- **Donation.** A sponsorship payment *is* a core donation, recorded by the core use case. Corrections and
  cancellations use the core CorrectDonation and cancel flows, so receipt replacement (US-47) behaves as for
  any other donation.
- **Permission.** The new areas go through the existing matrix. Nothing in `rbac`, the guards or the
  impersonation rules changes.
- **Financial.** Receipt numbering, obligation recalculation, FX conversion, audit chain and outbox run
  inside the core transaction, which the extension cannot join. The extension's own state (`paid_through`)
  is derived after commit and can always be rebuilt from core donations.

## 7. Guardrails and how they are enforced

| Rule | Enforcement |
|---|---|
| Extensions do not import core internals or Prisma delegates for core models | ESLint import-boundary rule (`extensions/**` may import only `@cms/contracts` and core module public `index.ts` exports) |
| Extension PRs do not modify core paths | CODEOWNERS on `apps/api/src/modules/**` and core schema files, plus a CI check that flags PRs touching both `extensions/**` and core paths |
| Every extension route declares a permission | Same lint rule and boot assertion as core routes |
| Extension tables are tenant-isolated | Migration lint: every `ext_*` table has `org_id` and `FORCE ROW LEVEL SECURITY`; the generated cross-tenant suite covers `/api/v1/ext/**` routes from the OpenAPI inventory |
| Extensions never run inside core transactions | The contract offers no hook into them: subscribers are worker-side, outbox-fed only |
| The core keeps working when an extension is broken or disabled | CI runs the core integration and E2E suites twice, with the manifest empty and with all extensions registered; both must pass |

## 8. Acceptance trace (US-67)

| Checklist item | Where |
|---|---|
| Extension points are named | Section 4 (EP-1 … EP-7), contract in section 3 |
| A sample charity-specific feature is shown | Section 6 (orphan sponsorship) |
| The sample needs no change to the core organisation, user, donation, permission or financial workflows | Sections 6.2 and 6.3 |
| Edge case: an extension needs a new permission area | Section 5 |

## 9. Out of scope and open questions

- The code for `ExtensionRegistry`, `organisation_extensions`, the lint rules and the dual-manifest CI run
  belongs to implementation stories that follow the application scaffold. This document is their
  specification.
- Third-party or runtime-loaded plugins are out of scope. Extensions are first-party code, reviewed and
  shipped in the same image.
- Open: should an organisation administrator, rather than only a super administrator, be able to enable an
  extension for their own organisation?
- Open: may an extension declare `@Public` routes, for example a public sponsorship sign-up page? The
  current answer is no without a dedicated security review.
