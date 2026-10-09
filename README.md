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

## Platform setup: the initial super administrator

The super administrator role is a platform role (`platform_roles`), separate from every
organisation's roles, so an organisation administrator can never grant it.

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
  before it can do anything else. Credentials that leaked into deployment logs stop working once
  that happens.
- The command never logs the password or its hash.

## Break-glass recovery

If the only super administrator is locked out (forgotten password, suspended account), someone with
shell access to the host can reset it from deployment configuration:

```sh
DATABASE_URL=... SUPER_ADMIN_EMAIL=ops@example.org SUPER_ADMIN_PASSWORD_FILE=/run/secrets/super_admin_recovery pnpm super-admin:recover
```

This sets the given password, reactivates the account and requires a password change at the next
sign-in. It only works for an account that already holds the super administrator role.
