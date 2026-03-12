This project "OpenBeacon" is an open source, privacy-first family location tracking app with an optional self-hosted backend so users can manage their own data.

Users should be able to either host their own backend on their own hardware easily, or pay a simple monthly fee for us to host their own backend.

The core concept of this app is to be privacy focused so if users pay for us to host their own backend we shouldn't be able to know anything they are doing as it should be encrypted by default (server stores ciphertext only).

# Project Rules
1. Do not leave comments; code should be understandable by default. Only leave comments when working around dodgy implementations of other APIs.
2. When installing new packages always install the latest with the bun install command; don't guess the version number.
3. Before committing, run `bun install --frozen-lockfile`; if it fails due to lockfile changes, run `bun install`, commit `bun.lock`, then re-run the frozen install.
4. We need strong tools/rules to ensure high quality code so AI tools don't introduce errors. Anything added must keep strict type checking rules.
5. After making changes, always run the ci script (`bun run ci`) to ensure your changes haven't broken anything.
6. When making database changes make sure to create a migration with the db:generate script in the database package.
7. The mobile app must never rely on background JS timers for tracking. The “always works” tracking path must be native.
8. Mobile UI must be built from React Native core components; do not introduce UI frameworks/component libraries.
9. All TypeScript import paths must end with `.ts`, not `.js`.
10. Always use our custom tryCatch function instead of the standard try catch logic.
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
    console.log(result)
  ```

# Technology

## Backend
- Bun will be used in the backend, do not use npm/yarn/pnpm etc
- Backend will using Hono.
- The backend will use strict types. The only time a type shouldn't be strictly typed is if given explicit consent by the user.
- We should be using zod for input validation
- For environment variables in the backend we should be using the @t3-oss/env-core
- Database: PostgreSQL using Prisma for a connector
- Better Auth for authentication
- Deployment through Docker containers
- All code will be stored in a monorepo using Turborepo
- Biome for linting/formatting with all TS apps

## Mobile App (Priority: reliable background location)
### Framework + DX
- React Native + TypeScript
- Expo (development builds) for local dev speed; do not depend on paid Expo cloud services
- Expo Router for navigation/routing

### UI policy
- Native-first: use React Native core components (View/Text/Pressable/etc) and platform APIs.
- Do not use UI frameworks/component libraries. Build reusable UI primitives in-repo on top of native components.

### State, forms, data
- Server state: TanStack Query
- Local UI/app state: Zustand
- Forms: React Hook Form
- Validation: zod

### Storage
- Fast local KV: MMKV
- Secrets: SecureStore (Keychain/Keystore-backed)

### Animations + gestures
- Reanimated
- Gesture Handler

### Maps
- MapLibre + OpenStreetMap-compatible tiles; allow self-hosting tile server for fully self-hostable deployments

### Background location engine (must be native)
- Background location tracking must be implemented with native OS primitives:
  - iOS: Core Location with “Always” permission + background location mode; use a low-power strategy (significant-change / geofences) when appropriate and high-accuracy updates only when needed
  - Android: foreground service with location service type when actively tracking; respect modern background execution restrictions
- Use a small native “location engine” module (Swift/Obj-C + Kotlin) exposed to TS via a React Native native module (TurboModule / bridged module)
- Do not depend on paid / closed-source SDKs or services for background location tracking

### Location data pipeline
- Offline-first: write location points to a local queue first
- Encrypt locally before upload; server never sees plaintext locations
- Opportunistic upload + retry (background fetch can be used only for flushing the queue, not as the primary tracking mechanism)

### Testing + release
- Unit/component tests: Jest + React Native Testing Library (RNTL)
- E2E tests: Detox or Maestro
- Releases: fastlane (build/sign/release automation)

# Project Structure
/apps # All deployed applications
  /backend # Hono backend (Bun)
  /mobile # React Native app (TypeScript)

/packages # All shared code
  /database # Prisma Database ORM
  /tsconfig # tsconfig shared logic
  /shared # shared TS utilities/types (non-platform-specific)
  /location-engine # React Native native module + TS API (iOS + Android native code lives here)
