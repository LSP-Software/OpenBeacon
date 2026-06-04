This project "OpenBeacon" is an open source, privacy-first family location tracking app with an optional self-hosted backend so users can manage their own data.

Users should be able to either host their own backend on their own hardware easily, or pay a simple monthly fee to use our hosted API.

The core concept of this app is to be privacy focused so if users pay for us to host their own backend we shouldn't be able to know anything they are doing as it should be encrypted by default.

# Project Rules
1. Do not leave comments; code should be understandable by default. Only leave comments when working around dodgy implementations of other APIs.
2. When installing new packages always install the latest with the bun `install command`; don't guess the version number.
3. Before committing, run `bun install --frozen-lockfile`; if it fails due to lockfile changes, run `bun install`, commit `bun.lock`, then re-run the frozen install.
4. After making changes, always run the ci script (`bun run ci`) to ensure your changes haven't broken anything.
5. We need strong types to ensure high quality code so AI tools don't introduce errors, anything added must use strict types, try to reuse types where possible but if not introduce types.
6. When making database changes make sure to create a migration with the db:generate script in the database package.
7. Mobile UI must be built from React Native core components; do not introduce UI frameworks/component libraries.
8. All TypeScript import paths must end with `.ts`, not `.js`.
9. Try to use our custom try catch function instead of the standard try catch implementation. When awaiting many calls in one go this can get lengthy so feel free to use the old try catch to keep it simple.
  ```ts
    // WRONG
    try {
      const result = await addTwoNumbers(1, 2);
      console.log(result)
    } catch (e) {
      console.log('ERROR');
    }

    //Correct
    const result = await tryCatch(addTwoNumbers(1, 2));
    if (result.error) {
      console.log('ERROR');
      return
    }
    console.log(result.data)
  ```
10. Always use const name = () => {} over function name () {}
11. When using types we should be careful about how we define them.
  a. If a type is only used once in a file, inline it. This applies to props, context values, params, and return types.
  b. Do not create `FooProps`, `FooState`, `FooContextType` or similar aliases unless that exact type is reused in multiple places in the same file.
  c. If a type is used in multiple places in the same file, define the type separately inside that file.
  d. If a type is used across multiple files, define it in its own type file. Feel free to put a type in an existing type file if it matches the theme.
  e. If a type alias only names an object literal used in one place, inline it instead.
  f. Only extract a local type when inlining would make the code materially harder to read.
  g. Whilst rules a-f provide default guidance, prioritise readability above all. When extracting any local type for readability, place function types at the bottom of the file and other types near their first usage.
12. When defining the database schema don't map field and table names
13. When adding a link to another page make sure to use expo link component

# Testing
When logic is added we should add tests around it to ensure high quality code. Test should be thoughtful and well considered and not just be added to test everything. We don't need to test that a button works, however logic around encryption etc should be tested to ensure we cannot break it.

# Code Styling
Code should be written as simply as possible to help with readability in the future. Functions should only be split into separate functions when either the original function becomes extremely long, or when logic inside of that function is reused. Things such as constants shouldn't be extracted unless they're re-used, same with types etc.

## Type Style Examples
Prefer this:
```ts
const ExampleContext = createContext<{
  value: string;
  setValue: (value: string) => void;
} | null>(null);

export const ExampleProvider = ({ children }: { children: React.ReactNode }) => {
```

Avoid this unless the type is reused more than once in the same file:
```ts
type ExampleContextType = {
  value: string;
  setValue: (value: string) => void;
};

type ExampleProviderProps = {
  children: React.ReactNode;
};

const ExampleContext = createContext<ExampleContextType | null>(null);

export const ExampleProvider = ({ children }: ExampleProviderProps) => {
```

## Cursor Cloud specific instructions

### Services

| Service | Port | Start command |
|---------|------|---------------|
| PostgreSQL 16 | 5432 | `sudo docker compose up -d db` |
| Dragonfly (Redis) | 6379 | `sudo docker compose up -d redis` |
| Backend API | 3000 | `bun run dev --filter=@openbeacon/backend` |

In Cloud Agent VMs, Docker is not running by default. Start the daemon once per session before `docker compose`:

```sh
sudo dockerd > /tmp/dockerd.log 2>&1 &
```

Use `docker compose up -d` from the repo root for both infra services. Apply migrations with `cd packages/database && bun run db:migrate:deploy` (non-interactive; prefer this over `db:migrate` in automation).

### Environment

Root `.env` and `apps/mobile/.env` are gitignored. Cloud VMs provide the required secrets as environment variables (`BETTER_AUTH_*`, `DATABASE_URL`, `REDIS_URL`, S3/R2 keys, `EXPO_PUBLIC_DEV_API_URL`). Create the files locally from those values before starting the backend.

`DATABASE_URL` should target `localhost:5432/openbeacon` when using the Docker Postgres service (user/password/db: `openbeacon`).

### Commands (see README.md for full setup)

- Install: `bun install --frozen-lockfile` (Bun **1.3.10**, pinned in root `package.json`)
- Lint/typecheck: `bun run ci` (no Docker services required)
- Tests: `bun run test` (uses `.env` for packages that need it; Postgres/Redis required for integration paths in `@openbeacon/cache` / `@openbeacon/api`)
- Backend dev: `bun run dev --filter=@openbeacon/backend`

### Mobile app

The Expo app (`apps/mobile`) targets native Android/iOS and is not runnable end-to-end in Cloud Agent VMs without an emulator or physical device. Backend + auth/tRPC API verification is the practical E2E path here (e.g. `POST /api/auth/sign-up/email`, then `GET /api/auth/get-session`).

### Gotchas

- Backend startup runs `db:generate` via Turbo; first boot may take a few seconds while Prisma client generates.
- If port 3000 is already in use, stop the existing backend process before starting another dev server.
- `bun run build` at the repo root currently defines no Turbo build tasks; use package-level scripts if you need builds.
