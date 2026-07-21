# Android verification stack decision (OPE-98)

Status: decided. This records the empirically selected local Android agent-verification
runner for the "Local agent app verification" project, plus the rejected fallback.

## Decision

**Maestro CLI is the selected local runner.** Google's Android CLI Journeys was compared
against the same throwaway journey and rejected as the primary runner. Appium was not
adopted because no required interaction failed with Maestro.

Google's Android CLI is retained as a complementary low-level escape hatch (`layout`,
`screen capture`, `run`) alongside `adb`, but not as the journey runner.

## What was compared

The same throwaway synthetic journey was defined once and exercised against the real
OpenBeacon Android development build (Expo dev client loading from local Metro) with both
runners: reach the map after a disposable sign-in, inspect semantic UI, screenshot the
MapLibre surface, pan the map, and observe the injected device location.

- Maestro flow: `packages/verification/journeys/openbeacon-map.maestro.yaml`
- Android CLI journey (agentic form): `packages/verification/journeys/openbeacon-map.journey.xml`

The two runners could not exercise the journey identically, and that asymmetry is itself a
key finding. Maestro executed the entire authenticated journey deterministically from one
versioned flow. Google's Android CLI has no scripted-flow capability: its Journeys feature
is agent/vision-driven, so the CLI could only be exercised as an agent-driven probe of the
same journey's capabilities against the running build (semantic `layout`, `screen capture`,
plus `adb` fallbacks for the pan and Logcat). The inability to run the journey as a
self-contained, repeatable command is a primary reason for the decision below.

## Environment identity

| Item | Value |
| --- | --- |
| Runner (selected) | Maestro CLI 2.7.0 |
| App | `net.openbeacon.app` (debug dev build) |
| Device runtime | Android Emulator |
| AVD | `Pixel_10_Pro_XL` |
| Model | `sdk_gphone16k_arm64` |
| Android | API 37 (release 17) |
| adb | 1.0.41 |
| emulator | 36.6.11.0 (build_id 15507667) |
| Android CLI | 1.0.15857036 |

## Empirical results

### Maestro (selected)

- Completed **three clean repetitions** with the same observable result and no manual
  intervention (`overallStatus: pass`).
- Proved every required capability from a single, deterministic, versioned flow:
  - Semantic UI inspection — `assertVisible` on text/labels plus a `uiautomator` layout dump.
  - MapLibre screenshot — `takeScreenshot` of the rendered basemap.
  - Map gesture — `swipe` across the map surface, with a second screenshot.
  - Location-state observation — `FusedLocation` delivery captured from Logcat after a
    mock GPS fix.
  - Logcat capture — full and filtered logs.
- Device is selected non-interactively via `--device <serial>`; artifacts land under
  `--test-output-dir`.

### Android CLI Journeys (rejected as primary)

- `android layout` produced a usable semantic tree, and `android screen capture` produced a
  valid MapLibre screenshot — both good, deterministic primitives.
- However, release `1.0.15857036` exposes **no standalone `journeys run` command**. Journeys
  is agent/vision-driven: it needs an AI agent to interpret each natural-language step at
  runtime. That is not a self-contained, repeatable repository command, and it introduces a
  model dependency and per-step nondeterminism.
- The CLI has **no first-class gesture primitive** and **no Logcat command**; the map pan and
  location observation had to fall back to `adb` (`input swipe`, `logcat`). A runner that
  cannot script a gesture or read logs on its own cannot own the journey.

Net: Android CLI is excellent for one-shot inspection primitives but cannot, by itself,
deliver a deterministic, repeatable, headless journey with gestures and log assertions.
Maestro can.

### Appium

Not adopted. The rule for this project is to adopt Appium only if a concrete required
interaction cannot be completed by the preferred candidates. No such case arose — Maestro
handled sign-in, navigation, semantic assertions, screenshots, and gestures.

## Telemetry / analytics

Disabled where supported:

- Emulator: launched with `-no-metrics`.
- Maestro: run with `MAESTRO_DISABLE_ANALYTICS=true`.
- Android CLI: invoked with `--no-metrics`.
- Metro: start with `EXPO_NO_TELEMETRY=1`.

Unavoidable / documented:

- First-time Android CLI setup downloads its runtime from `dl.google.com` (one-off; the
  binary is a self-updating launcher). No app or user data is transmitted.
- Maestro installs its device driver/server APKs onto the emulator on first run.
- Neither of these transmits OpenBeacon account, family, or location data.

## Privacy

The journey uses only:

- A disposable synthetic account created against a local, isolated backend.
- A mock GPS fix (London, `51.5072, -0.1276`) injected via `adb emu geo fix`.
- Throwaway device state — the app is reinstalled fresh each Maestro run.

No personal account, family, or real location data is involved.

## Reproduce

See `packages/verification/README.md`. Summary:

```bash
# selected runner, three clean repetitions
bun run --cwd packages/verification verify:android

# android CLI comparison probe against the current signed-in map
bun run --cwd packages/verification verify:android -- --runner android-cli
```

Structured `report.json` / `report.md`, screenshots, layout dumps, and Logcat are written to
`.verification-artifacts/` (git-ignored). Each report also states that human review is still
required; agent verification is only a pre-review quality filter.
