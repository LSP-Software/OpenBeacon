# @openbeacon/verification

Local, repository-owned Android agent-verification harness (OPE-98).

It selects a named Android emulator without an interactive device chooser, installs
and launches the real OpenBeacon development build, exercises a throwaway synthetic
map journey, captures evidence (semantic UI layout, MapLibre screenshots, a map
gesture, location-state via Logcat), and writes a structured pass/fail report.

This is a pre-review quality filter. It never replaces human product or code review,
and it uses only disposable synthetic accounts, a mock GPS fix, and throwaway device
state — no personal, family, or real location data.

## Selected runner

Maestro is the selected local runner. Google's Android CLI Journeys was compared and
rejected as the primary runner. See
[`docs/research/android-verification-stack-decision.md`](../../docs/research/android-verification-stack-decision.md).

## Prerequisites

- macOS with the Android SDK (`adb`, `emulator`) and Java 17.
- An AVD (default `Pixel_10_Pro_XL`).
- Maestro CLI installed (`curl -fsSL https://get.maestro.mobile.dev | bash`).
- A built development APK at `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
  (`bun run --cwd apps/mobile android`) or `OPENBEACON_VERIFY_APK` pointing at one.
- Docker (Postgres + Redis) and a disposable local backend.

## One-time disposable environment

1. Start Postgres and Redis: `docker compose up -d`.
2. Create an isolated database and env file outside the repo, e.g. `/tmp/ope98-verify.env`
   (see `.env.example`). Copy the `S3_*`/`R2_*` values from your own local backend `.env`.
3. Apply migrations to the isolated database:
   `bun run --cwd packages/database --env-file=/tmp/ope98-verify.env prisma migrate deploy`.
4. Start the backend with the verification env:
   `bun run --env-file=/tmp/ope98-verify.env apps/backend/src/index.ts`.
5. Start Metro pointing at the local backend:
   `EXPO_PUBLIC_DEV_API_URL=http://10.0.2.2:3000 bun run --cwd apps/mobile start`.
6. Create the throwaway account: `bun run --cwd packages/verification prepare:env`.

## Run

```bash
# Selected runner, three clean repetitions (default):
bun run --cwd packages/verification verify:android

# Android CLI comparison probe against the current signed-in map (agent-driven):
bun run --cwd packages/verification verify:android -- --runner android-cli
```

Artifacts and `report.json` / `report.md` are written to `.verification-artifacts/`
(git-ignored).

## Configuration

All settings have defaults and can be overridden by environment variables:
`OPENBEACON_VERIFY_AVD`, `OPENBEACON_VERIFY_PACKAGE`, `OPENBEACON_VERIFY_APP_SCHEME`,
`OPENBEACON_VERIFY_METRO_HOST`, `OPENBEACON_VERIFY_METRO_PORT`,
`OPENBEACON_VERIFY_API_PORT`, `OPENBEACON_VERIFY_APK`, `OPENBEACON_VERIFY_EMAIL`,
`OPENBEACON_VERIFY_PASSWORD`, `OPENBEACON_VERIFY_LAT`, `OPENBEACON_VERIFY_LON`,
`OPENBEACON_VERIFY_ARTIFACTS`, `OPENBEACON_VERIFY_MAESTRO_BIN`,
`OPENBEACON_VERIFY_ANDROID_CLI_BIN`.

## Telemetry

The harness disables analytics where supported: the emulator runs with `-no-metrics`,
Maestro with `MAESTRO_DISABLE_ANALYTICS=true`, and Google's Android CLI with `--no-metrics`.
Start Metro with `EXPO_NO_TELEMETRY=1`. Unavoidable telemetry is documented in the
decision record.
