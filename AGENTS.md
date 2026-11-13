This project "OpenBeacon" is an open source, privacy-first family location tracking app with an optional self-hosted backend so users can manage their own data.

Users should be able to either host their own backend on their own hardware easily, or pay a simple monthly fee to use our hosted API.

Privacy is the core concept. Locations, battery levels, nicknames and group colours are end-to-end encrypted on the phone, so a server running our code, hosted or self-hosted, stores them without being able to read them. The server still sees accounts, group membership, profile and group images and connection metadata, and phones trust it for other members' public keys. `docs/security/beta-1-privacy-draft.md` is the source of truth for what the operator can see: keep every user-facing privacy claim, in the app, README and docs, matching it, and encrypt new user data end to end unless the server needs to read it.

# Project Rules

1. Do not leave comments; code should be understandable by default. Only leave comments when working around dodgy implementations of other APIs.
2. When installing new packages always install the latest with the bun `install command`; don't guess the version number.
3. Before committing, run `bun install --frozen-lockfile`; if it fails due to lockfile changes, run `bun install`, commit `bun.lock`, then re-run the frozen install.
4. After making changes, always run the ci script (`bun run ci`) to ensure your changes haven't broken anything.
5. We need strong types to ensure high quality code so AI tools don't introduce errors, anything added must use strict types, try to reuse types where possible but if not introduce types.
6. When making database changes make sure to create a migration with the db:migrate script in the database package. db:generate only regenerates the Prisma client.
7. All TypeScript import paths must end with `.ts`, not `.js`.
8. Try to use our custom try catch function instead of the standard try catch implementation. When awaiting many calls in one go this can get lengthy so feel free to use the old try catch to keep it simple.

```ts
// WRONG
try {
  const result = await addTwoNumbers(1, 2);
  console.log(result);
} catch (e) {
  console.log("ERROR");
}

//Correct
const result = await tryCatch(addTwoNumbers(1, 2));
if (result.error) {
  console.log("ERROR");
  return;
}
console.log(result.data);
```

9. Always use const name = () => {} over function name () {}
10. When using types we should be careful about how we define them.
    a. If a type is only used once in a file, inline it. This applies to props, context values, params, and return types.
    b. Do not create `FooProps`, `FooState`, `FooContextType` or similar aliases unless that exact type is reused in multiple places in the same file.
    c. If a type is used in multiple places in the same file, define the type separately inside that file.
    d. If a type is used across multiple files, define it in its own type file. Feel free to put a type in an existing type file if it matches the theme.
    e. If a type alias only names an object literal used in one place, inline it instead.
    f. Only extract a local type when inlining would make the code materially harder to read.
    g. Whilst rules a-f provide default guidance, prioritise readability above all. When extracting any local type for readability, place function types at the bottom of the file and other types near their first usage.
11. When defining the database schema don't map field and table names
12. When adding a link to another page make sure to use expo link component
13. Every PR that changes shipped code must bump the matching version. Test files and Markdown don't count.
    a. Client (`apps/mobile`, `packages/encryption`, `packages/schemas`, `packages/shared`): raise `expo.version` in `apps/mobile/app.json` and increment both `ios.buildNumber` and `android.versionCode`.
    b. Server (`apps/backend`, `apps/scheduled-jobs`, `apps/map-tiles`, and `packages/*` except `tsconfig`): raise `serverVersion` in `apps/backend/src/version.ts`.
    c. Use patch for fixes, minor for features or database migrations. CI enforces this; check locally with `bun scripts/check-version-bump.ts origin/main`.
14. API compatibility levels live in `packages/shared/src/apiCompatibilityLevel.ts`. Change them only when:
    a. The app calls something older servers don't have: raise `apiCompatibilityLevel` and set `minServerApiCompatibilityLevel` to it.
    b. You remove or narrow something supported apps use: raise `apiCompatibilityLevel` and set `minClientApiCompatibilityLevel` to it.
    c. You change an encrypted format or what a field means: raise the minimum for whichever side can't cope.
    d. Any level change needs at least a minor version bump of both the app and the server. Anything else needs no level change. See `docs/development/api-compatibility.md`.
    e. Every PR body contains either `API compatibility: unchanged` or `API compatibility: raised because …`.

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

## Agent skills

### Issue tracker

Issues are tracked in Linear under the Open Beacon team (`OPE`) using the Linear MCP tools. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five canonical label names without overrides. See `docs/agents/triage-labels.md`.

### Domain docs

OpenBeacon uses a multi-context domain layout. See `docs/agents/domain.md`.
