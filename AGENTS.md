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

### Services overview

| Service | How to start |
|---|---|
| PostgreSQL 16 + DragonflyDB (Redis) | `sudo docker compose up -d` (from repo root) |
| Backend API (Hono + tRPC + Better Auth) | `bun run dev --filter=@openbeacon/backend` or directly: `bun run --env-file=.env --hot apps/backend/src/index.ts` (port 3000) |
| Mobile (Expo/React Native) | Cannot run in headless Cloud VM — requires Android/iOS emulator |

### Key commands

See `package.json` scripts at root for `dev`, `ci`, `typecheck`, `check`, `test`. Per the project rules, always run `bun run ci` after changes.

### Non-obvious caveats

- Docker must be running before starting the backend — PostgreSQL and DragonflyDB are required. Start Docker daemon with `sudo dockerd &` if not already running, then `sudo docker compose up -d`.
- The `.env` file lives at the repo root and is loaded by the backend via `--env-file=.env`. It is **not** committed to the repo. S3/R2 env vars (`S3_ACCESS_KEY_ID`, `S3_ACCESS_KEY`, `S3_BUCKET_NAME`, `R2_*`) are required by env validation even for local dev — use stub values if you don't need image upload or map tile features.
- Prisma client must be generated before typecheck will pass: `cd packages/database && bun run db:generate`. Migrations: `bun run db:migrate:deploy`.
- The `database` package typecheck script runs `prisma generate` itself, so `bun run ci` (which runs `turbo typecheck`) will auto-generate the Prisma client as a side effect.
- Tests (`bun run test`) run across all packages via Turborepo. The API package tests require a running PostgreSQL instance.
- The pre-commit hook (`.husky/pre-commit`) runs `bun install --frozen-lockfile` then `bun run ci`.
