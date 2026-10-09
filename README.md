# donation-system

Charity donation management CMS: a pnpm monorepo with `apps/api` (NestJS API) and `packages/db`
(Prisma schema, migrations and client).

## Development

```sh
pnpm install
pnpm build        # generates the Prisma client and compiles the packages
pnpm lint
pnpm typecheck
pnpm test
```

Prisma commands read `DATABASE_URL` from the environment, e.g.
`DATABASE_URL=postgresql://... pnpm --filter @cms/db migrate:deploy`.

### Integration tests against PostgreSQL

The specs named `*.postgres.spec.ts` run only when `TEST_DATABASE_URL` points at a disposable
postgres:16 database with the migrations applied. They truncate the tables they use.

```sh
DATABASE_URL=$TEST_DATABASE_URL pnpm --filter @cms/db migrate:deploy
TEST_DATABASE_URL=postgresql://... pnpm --filter @cms/api test
```

## Platform setup: the initial super administrator

The super administrator role is a platform role (`platform_roles`), separate from every
organisation's roles, so an organisation administrator can never grant it. The database also
refuses any write to the platform-role tables from a transaction that has an organisation context
(`app.org_id`) set.

After migrations have run, create the role and the initial account with:

```sh
DATABASE_URL=... SUPER_ADMIN_EMAIL=ops@example.org SUPER_ADMIN_PASSWORD_FILE=/run/secrets/super_admin_password pnpm seed
```

| Variable | Purpose |
| --- | --- |
| `SUPER_ADMIN_EMAIL` | Email address of the initial super administrator. |
| `SUPER_ADMIN_PASSWORD_FILE` | Preferred. Path to a file (e.g. a Docker secret) holding the initial password. |
| `SUPER_ADMIN_PASSWORD` | Fallback when no file is given. Avoid it where the environment is printed in deploy logs. |

The password must be 12–128 characters.

- The command is idempotent. Once a super administrator exists, it creates nothing and changes
  nothing, and it does not need the credential variables at all. Remove them from the deployment
  configuration after the first run.
- The initial account must set a new password, different from the initial one, at first sign-in
  before it can do anything else. `POST /auth/login` records `mustChangePassword` in the session, and
  the global `PasswordChangeRequiredGuard` refuses every route except login, password change and
  logout until `POST /auth/password/change` succeeds. The session ID is rotated at login and after
  the change. Credentials that leaked into deployment logs stop working once that happens.
- The command never logs the password or its hash.

## Break-glass recovery

If the only super administrator is locked out (forgotten password, suspended account), someone with
shell access to the host can reset it from deployment configuration:

```sh
DATABASE_URL=... SUPER_ADMIN_EMAIL=ops@example.org SUPER_ADMIN_PASSWORD_FILE=/run/secrets/super_admin_recovery pnpm super-admin:recover
```

This sets the given password, reactivates the account and requires a password change at the next
sign-in. It only works for an account that already holds the super administrator role.

**Recovery does not yet end live sessions.** A session that was already signed in keeps its
own copy of the password-change flag and stays valid until it expires. Password change has the
same gap: it rotates only the caller's session. If you run recovery because the account may be
compromised, also flush the session store (restart Redis or delete its session keys) until the
follow-up below lands.

## Known follow-ups from US-71

These are tracked against later stories and are not done here:

- **HTTP bootstrap and sessions.** No AppModule, `main.ts` or `@fastify/session` exists yet.
  `IdentityModule.register(...)` must be imported after the session middleware and `SessionGuard`.
  If it is not, the guard sees no `userId` and defers on every request. That story must add an HTTP
  end-to-end test: seeded login → any other route returns 403 `PASSWORD_CHANGE_REQUIRED` →
  password change → route allowed.
- **Revoking every session.** Once the per-user session index exists, `recoverSuperAdmin` and a
  successful password change must end all of the user's other sessions.
- **Audit trail.** Creating the initial account, break-glass recovery, and platform-role grant and
  revoke must write entries to the append-only `audit_log` in the same transaction once that table
  exists (REQ-048).
- **Lockfile.** The repository still has an npm `package-lock.json` and no `pnpm-lock.yaml`.
  Replace it with the lockfile produced by `pnpm install`, and use `pnpm install --frozen-lockfile`
  in CI.
