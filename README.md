# donation-system

Charity donation management CMS (pnpm monorepo).

## Workspace

- `apps/web` — React 19 + Vite + Mantine admin SPA.

## Scripts

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Admin UI conventions

- Destructive or financially significant actions go through `ConfirmDialog`
  (`apps/web/src/components/confirm`). Dismissing the dialog never sends a request.
- Every save goes through `useSave` (`apps/web/src/lib/feedback`), which reports success or a
  failure that names its cause (validation, permission, expired session, conflict, ...) and never
  clears the user's input.
